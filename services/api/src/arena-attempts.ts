import { StartExecutionCommand } from '@aws-sdk/client-sfn';
import {
  attackCategories,
  checkAttackText,
  dealTemplates,
  findDealTemplate,
  MAX_ATTACK_LENGTH,
  pickDailyChallenge,
} from '@handshake/arena';
import {
  createArenaAttempt,
  getArenaAttempt,
  getTokensUsed,
  takeRateLimitSlot,
  type StoredAttempt,
} from '@handshake/store';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { findSessionChallenger, type ArenaApiContext } from './arena-challengers';
import { hashToken, json, parseJson } from './http';

// Every attempt costs model calls. Judges may share one IP, so the limit
// leaves room for several of them testing at once.
const ATTEMPTS_PER_IP_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;
// ArenaRun stops itself after 30 minutes. That timeout cannot mark the attempt,
// and neither can a run that never started, so an older attempt counts as failed.
const RUN_DEADLINE_MS = 35 * 60 * 1000;

const attemptBodySchema = z.object({
  category: z.enum(attackCategories),
  channel: z.enum(['listing', 'message', 'evidence']),
  // The real limit is checked after trimming; this only keeps huge bodies out.
  attackText: z.string().max(MAX_ATTACK_LENGTH * 2),
  dailyChallenge: z.boolean().default(false),
  // The daily challenge plays the day's deal, so a chosen deal applies only outside it.
  dealId: z.string().max(64).nullable().default(null),
});

export interface AttemptRequest {
  body: string;
  cookies: readonly string[];
  sourceIp: string;
}

/** Stores the challenger's attack and starts the ArenaRun state machine for it. */
export async function submitAttempt(
  context: ArenaApiContext,
  request: AttemptRequest,
): Promise<APIGatewayProxyStructuredResultV2> {
  const session = await findSessionChallenger(context, request.cookies);
  if (!session.found) return session.response;

  const parsed = attemptBodySchema.safeParse(parseJson(request.body));
  if (!parsed.success) {
    return json(400, { error: 'Send a JSON body with a category, a channel and attackText' });
  }
  const check = checkAttackText(parsed.data.attackText);
  if (!check.valid) return json(400, { error: check.reason });
  const { dealId, dailyChallenge } = parsed.data;
  if (dealId !== null && !findDealTemplate(dealId)) {
    return json(400, { error: 'There is no arena deal with this ID' });
  }

  const now = context.now();
  const hour = now.toISOString().slice(0, 13);
  const allowed = await takeRateLimitSlot(context.table, {
    subject: hashToken(request.sourceIp),
    window: hour,
    limit: ATTEMPTS_PER_IP_PER_HOUR,
    expiresAt: new Date(Date.parse(`${hour}:00:00Z`) + 2 * HOUR_MS),
  });
  if (!allowed) {
    return json(429, { error: 'Too many attempts from your network. Try again next hour' });
  }

  const today = now.toISOString().slice(0, 10);
  if ((await getTokensUsed(context.table, today)) >= context.dailyTokenBudget) {
    return json(503, { error: 'The arena has used its AI budget for today. Come back tomorrow' });
  }

  const attemptId = context.newAttemptId();
  await createArenaAttempt(context.table, {
    id: attemptId,
    challengerId: session.challenger.id,
    category: parsed.data.category,
    channel: parsed.data.channel,
    attackText: check.text,
    dailyChallengeDate: dailyChallenge ? today : null,
    dealTemplateId: dailyChallenge ? null : dealId,
    createdAt: now.toISOString(),
  });
  // The execution is named after the attempt, so the same attempt never runs twice.
  await context.stepFunctions.send(
    new StartExecutionCommand({
      stateMachineArn: context.arenaRunArn,
      name: attemptId,
      input: JSON.stringify({ attemptId }),
    }),
  );
  return json(202, { attemptId, status: 'running' });
}

/**
 * The deals a challenger can attack. The seller's floor and the buyer's
 * maximum stay hidden: finding a way past them is the game.
 */
export function listArenaDeals(context: ArenaApiContext): APIGatewayProxyStructuredResultV2 {
  const today = context.now().toISOString().slice(0, 10);
  return json(200, {
    dailyDealId: pickDailyChallenge(today, dealTemplates).id,
    deals: dealTemplates.map((template) => ({
      id: template.id,
      seller: { name: template.seller.name, persona: template.seller.persona },
      listing: {
        title: template.listing.title,
        description: template.listing.description,
        listPrice: template.listing.listPrice,
      },
      buyerGoal: template.buyer.goal,
      acceptanceCriteria: template.acceptanceCriteria,
      deliveryDays: template.deliveryDays,
    })),
  });
}

/** Attempts are public, so anyone with the link can watch the result and share it. */
export async function getAttempt(
  context: ArenaApiContext,
  attemptId: string | undefined,
): Promise<APIGatewayProxyStructuredResultV2> {
  const attempt = z.uuid().safeParse(attemptId).success
    ? await getArenaAttempt(context.table, attemptId ?? '')
    : undefined;
  if (!attempt) return json(404, { error: 'There is no attempt with this ID' });
  return json(200, publicAttempt(attempt, context.now()));
}

function failureReason(attempt: StoredAttempt, now: Date): 'budget' | 'error' | null {
  if (attempt.result) return null;
  if (attempt.failure) return attempt.failure.reason;
  return now.getTime() - Date.parse(attempt.createdAt) > RUN_DEADLINE_MS ? 'error' : null;
}

function publicAttempt(attempt: StoredAttempt, now: Date) {
  const { result } = attempt;
  const failure = failureReason(attempt, now);
  return {
    id: attempt.id,
    challengerId: attempt.challengerId,
    category: attempt.category,
    channel: attempt.channel,
    attackText: attempt.attackText,
    dailyChallengeDate: attempt.dailyChallengeDate,
    dealId: attempt.dealTemplateId,
    createdAt: attempt.createdAt,
    status: result ? 'judged' : failure ? 'failed' : 'running',
    failureReason: failure,
    run: attempt.run ?? null,
    result: result
      ? {
          outcome: result.outcome,
          xpGained: result.xpGained,
          rationale: result.rationale,
          nearDuplicateOf: result.nearDuplicateOf,
          recordedAt: result.recordedAt,
        }
      : null,
  };
}
