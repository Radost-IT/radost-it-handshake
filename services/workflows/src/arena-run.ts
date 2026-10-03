import { judgeArenaAttempt, type LlmProvider } from '@handshake/agents';
import { buildRegressionCase, scoreAttempt } from '@handshake/arena';
import { type BountyLimits } from '@handshake/core';
import type { PayPalClient } from '@handshake/paypal';
import { payBounty } from '@handshake/settlement';
import {
  ArenaRecordNotFoundError,
  getArenaAttempt,
  getChallenger,
  listRegressionCases,
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

export interface ArenaRunContext {
  table: StoreTable;
  llm: LlmProvider;
  paypal: PayPalClient;
  dealSource: ArenaDealSource;
  negotiationMaxTurns: number;
  bountyLimits: BountyLimits;
  now: () => string;
}

const attemptId = z.string().min(1);

/** The input the ArenaRun state machine sends with each Lambda task. */
export const arenaTaskSchema = z.discriminatedUnion('task', [
  z.object({ task: z.literal('RunDeal'), attemptId }),
  z.object({ task: z.literal('Judge'), attemptId }),
  z.object({ task: z.literal('SaveRegression'), attemptId }),
  z.object({ task: z.literal('PayBounty'), attemptId }),
]);

export type ArenaTask = z.infer<typeof arenaTaskSchema>;

export type ArenaTaskResult =
  | { task: 'RunDeal' }
  | { task: 'Judge'; loophole: boolean }
  | { task: 'SaveRegression'; saved: boolean }
  | { task: 'PayBounty'; bounty: 'none' | 'paid' | 'refused'; reason?: string };

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
  const attempt = await getArenaAttempt(context.table, task.attemptId);
  if (!attempt) throw new ArenaRecordNotFoundError(`Attempt ${task.attemptId} does not exist`);
  switch (task.task) {
    case 'RunDeal':
      if (!attempt.run) await runDeal(context, attempt);
      return { task: 'RunDeal' };
    case 'Judge':
      return { task: 'Judge', loophole: await judge(context, attempt) };
    case 'SaveRegression':
      return { task: 'SaveRegression', saved: await saveRegression(context, attempt) };
    case 'PayBounty':
      return { task: 'PayBounty', ...(await rewardLoophole(context, attempt)) };
  }
}

async function runDeal(context: ArenaRunContext, attempt: StoredAttempt): Promise<void> {
  const deal = await pickArenaDeal(context, attempt);
  const run = await runArenaAttack(
    { llm: context.llm, negotiationMaxTurns: context.negotiationMaxTurns, now: context.now() },
    deal,
    attempt,
  );
  await saveArenaRun(context.table, attempt.id, run);
}

async function judge(context: ArenaRunContext, attempt: StoredAttempt): Promise<boolean> {
  if (attempt.result) return attempt.result.outcome.result === 'loophole';
  if (!attempt.run) throw new ArenaStepOrderError(`Attempt ${attempt.id} has not run yet`);

  const cases = await listRegressionCases(context.table);
  const knownLoopholes = cases
    .filter((regression) => regression.category === attempt.category)
    .map((regression) => ({ id: regression.attemptId, summary: regression.judgeRationale }));
  const verdict = await judgeArenaAttempt(context.llm, {
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
