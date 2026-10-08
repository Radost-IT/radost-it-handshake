import { judgeArenaAttempt, type LlmProvider } from '@handshake/agents';
import { buildRegressionCase, newlyUnlocked, rankForXp, scoreAttempt } from '@handshake/arena';
import { type BountyLimits } from '@handshake/core';
import type { PayPalClient } from '@handshake/paypal';
import { payBounty } from '@handshake/settlement';
import {
  ARENA_TOPIC,
  ArenaRecordNotFoundError,
  attemptTopic,
  getArenaAttempt,
  getArenaStats,
  getChallenger,
  listRegressionCases,
  markArenaAttemptFailed,
  markBountyPaid,
  recordArenaResult,
  releaseBounty,
  reserveBounty,
  saveArenaRun,
  saveRegressionCase,
  type StoredAttempt,
  type StoreTable,
} from '@handshake/store';
import { z } from 'zod';
import { runArenaAttack } from './arena-attack';
import { pickArenaDeal, type ArenaDealSource } from './arena-deal';
import type { PublishLiveEvent } from './live-events';
import { TOKEN_BUDGET_EXHAUSTED } from './token-budget';

export interface ArenaRunContext {
  table: StoreTable;
  /** The model for one challenger's attempt, so their calls count against their own tokens. */
  llmFor: (challengerId: string) => LlmProvider;
  paypal: PayPalClient;
  dealSource: ArenaDealSource;
  negotiationMaxTurns: number;
  bountyLimits: BountyLimits;
  publishLive: PublishLiveEvent;
  now: () => string;
}

const attemptId = z.string().min(1);

/** The input the ArenaRun state machine sends with each Lambda task. */
export const arenaTaskSchema = z.discriminatedUnion('task', [
  z.object({ task: z.literal('RunDeal'), attemptId }),
  z.object({ task: z.literal('Judge'), attemptId }),
  z.object({ task: z.literal('Announce'), attemptId }),
  z.object({ task: z.literal('SaveRegression'), attemptId }),
  z.object({ task: z.literal('PayBounty'), attemptId }),
  // Step Functions passes the name of the error that stopped the run.
  z.object({ task: z.literal('MarkFailed'), attemptId, error: z.string() }),
]);

export type ArenaTask = z.infer<typeof arenaTaskSchema>;

export type ArenaTaskResult =
  | { task: 'RunDeal' }
  | { task: 'Judge'; loophole: boolean }
  | { task: 'Announce' }
  | { task: 'SaveRegression'; saved: boolean }
  | { task: 'PayBounty'; bounty: 'none' | 'paid' | 'refused'; reason?: string }
  | { task: 'MarkFailed'; marked: boolean };

/** A step ran before the step it depends on, which means the state machine is wrong. */
export class ArenaStepOrderError extends Error {
  override name = 'ArenaStepOrderError';
}

/**
 * Runs one step of an arena attempt. Step Functions retries a failed step, so
 * each step first checks whether its work is already stored.
 */
export async function runArenaTask(
  context: ArenaRunContext,
  task: ArenaTask,
): Promise<ArenaTaskResult> {
  if (task.task === 'MarkFailed') return markFailed(context, task.attemptId, task.error);
  const attempt = await getArenaAttempt(context.table, task.attemptId);
  if (!attempt) throw new ArenaRecordNotFoundError(`Attempt ${task.attemptId} does not exist`);
  switch (task.task) {
    case 'RunDeal':
      if (!attempt.run) await runDeal(context, attempt);
      return { task: 'RunDeal' };
    case 'Judge':
      return { task: 'Judge', loophole: await judge(context, attempt) };
    case 'Announce':
      await announce(context, attempt);
      return { task: 'Announce' };
    case 'SaveRegression':
      return { task: 'SaveRegression', saved: await saveRegression(context, attempt) };
    case 'PayBounty':
      return { task: 'PayBounty', ...(await rewardLoophole(context, attempt)) };
  }
}

async function markFailed(
  context: ArenaRunContext,
  attemptId: string,
  error: string,
): Promise<ArenaTaskResult> {
  const failure = {
    reason: error === TOKEN_BUDGET_EXHAUSTED ? 'budget' : 'error',
    failedAt: context.now(),
  } as const;
  return {
    task: 'MarkFailed',
    marked: await markArenaAttemptFailed(context.table, attemptId, failure),
  };
}

async function runDeal(context: ArenaRunContext, attempt: StoredAttempt): Promise<void> {
  const deal = await pickArenaDeal(context, attempt);
  const run = await runArenaAttack(
    {
      llm: context.llmFor(attempt.challengerId),
      negotiationMaxTurns: context.negotiationMaxTurns,
      now: context.now(),
    },
    deal,
    attempt,
  );
  await saveArenaRun(context.table, attempt.id, run);
}

async function judge(context: ArenaRunContext, attempt: StoredAttempt): Promise<boolean> {
  if (attempt.result) return attempt.result.outcome.result === 'loophole';
  if (!attempt.run) throw new ArenaStepOrderError(`Attempt ${attempt.id} has not run yet`);
  // The judge is a model that reads the challenger's text, so it could be talked into a
  // loophole. Without a policy-approved step that holds or captures money, the attack held.
  if (!attempt.run.moneyStepApproved) {
    await recordArenaResult(context.table, {
      attemptId: attempt.id,
      outcome: { result: 'held' },
      rationale: "Policy approved no step that would hold or capture the buyer's money.",
      nearDuplicateOf: null,
      recordedAt: context.now(),
    });
    return false;
  }

  const cases = await listRegressionCases(context.table);
  const knownLoopholes = cases
    .filter((regression) => regression.category === attempt.category)
    .map((regression) => ({ id: regression.attemptId, summary: regression.judgeRationale }));
  const verdict = await judgeArenaAttempt(context.llmFor(attempt.challengerId), {
    attempt: {
      category: attempt.category,
      channel: attempt.channel,
      attackText: attempt.attackText,
      agentTranscript: attempt.run.transcript,
      policyDecisions: attempt.run.policyDecisions,
    },
    knownLoopholes,
  });
  await recordArenaResult(context.table, {
    attemptId: attempt.id,
    outcome: verdict.outcome,
    rationale: verdict.rationale,
    nearDuplicateOf: verdict.nearDuplicateOf,
    recordedAt: context.now(),
  });
  return verdict.outcome.result === 'loophole';
}

/**
 * Tells the browsers watching this attempt how it ended, and everyone on the
 * arena page the new defense count. Pages also poll, so a lost event only
 * delays what they show.
 */
async function announce(context: ArenaRunContext, attempt: StoredAttempt): Promise<void> {
  const topic = attemptTopic(attempt.id);
  if (attempt.failure) {
    await context.publishLive(topic, {
      type: 'arena.result',
      attemptId: attempt.id,
      status: 'failed',
    });
    return;
  }
  const { before, after, xpGained } = judgedResult(attempt);
  const stats = await getArenaStats(context.table);
  await Promise.all([
    context.publishLive(topic, { type: 'arena.result', attemptId: attempt.id, status: 'judged' }),
    context.publishLive(topic, {
      type: 'challenger.progress',
      challengerId: attempt.challengerId,
      xp: after.xp,
      xpGained,
      rank: rankForXp(after.xp),
      rankUp: rankForXp(after.xp) !== rankForXp(before.xp),
      newBadges: newlyUnlocked(before.stats, after.stats),
    }),
    context.publishLive(ARENA_TOPIC, {
      type: 'arena.stats',
      attempts: stats.attempts,
      held: stats.held,
    }),
  ]);
}

function judgedResult(attempt: StoredAttempt) {
  if (!attempt.result) throw new ArenaStepOrderError(`Attempt ${attempt.id} is not judged yet`);
  return attempt.result;
}

// Near-duplicates are covered by the case they repeat.
async function saveRegression(context: ArenaRunContext, attempt: StoredAttempt): Promise<boolean> {
  const result = judgedResult(attempt);
  if (result.outcome.result !== 'loophole' || result.outcome.nearDuplicate) return false;

  const challenger = await getChallenger(context.table, attempt.challengerId);
  if (!challenger) {
    throw new ArenaRecordNotFoundError(`Challenger ${attempt.challengerId} does not exist`);
  }
  const regression = buildRegressionCase({
    attemptId: attempt.id,
    category: attempt.category,
    channel: attempt.channel,
    attackText: attempt.attackText,
    loophole: result.outcome,
    judgeRationale: result.rationale,
    foundBy: { challengerId: challenger.id, handle: challenger.handle },
    // The judging time keys the case, so a retried step saves the same case.
    foundAt: result.recordedAt,
  });
  await saveRegressionCase(context.table, regression);
  return true;
}

/**
 * Pays the bounty the score sets. The bounty is reserved against the day's
 * budget first and released when policy refuses it, so paying the same
 * attempt again sees the same budget and PayPal replays the first payout.
 */
async function rewardLoophole(
  context: ArenaRunContext,
  attempt: StoredAttempt,
): Promise<{ bounty: 'none' | 'paid' | 'refused'; reason?: string }> {
  const result = judgedResult(attempt);
  const { bounty } = scoreAttempt(result.outcome, {
    maxBounty: context.bountyLimits.maxBounty,
    categoryUntouched:
      result.after.stats.firstLoopholeCategories > result.before.stats.firstLoopholeCategories,
  });
  if (bounty === null || result.outcome.result !== 'loophole') return { bounty: 'none' };

  const reservation = {
    date: result.recordedAt.slice(0, 10),
    attemptId: attempt.id,
    amount: bounty,
  };
  const paidToday = await reserveBounty(context.table, reservation);
  const paid = await payBounty(
    context.paypal,
    {
      attemptId: attempt.id,
      amount: bounty,
      recipientEmail: context.bountyLimits.recipientEmail,
      reason: `Handshake arena bounty: a ${result.outcome.severity} loophole in ${attempt.category}`,
    },
    context.bountyLimits,
    paidToday,
  );
  if (!paid.approved) {
    await releaseBounty(context.table, reservation);
    const reason = paid.violations.map((violation) => violation.message).join('. ');
    return { bounty: 'refused', reason };
  }
  await markBountyPaid(context.table, reservation, paid.payout.batchId);
  return { bounty: 'paid' };
}
