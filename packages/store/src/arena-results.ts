import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { applyAttempt, type AttemptOutcome, type ChallengerProgress } from '@handshake/arena';
import type { z } from 'zod';
import {
  arenaResultSchema,
  attemptKey,
  storedAttemptSchema,
  type StoredAttempt,
} from './arena-attempts';
import { categoryKey, categoryStatsSchema, dailyStatsKey, globalStatsKey } from './arena-stats';
import { challengerKey, challengerSchema } from './challengers';
import { leaderboardKey } from './leaderboard';
import type { StoreTable } from './table';

export class ArenaRecordNotFoundError extends Error {
  override name = 'ArenaRecordNotFoundError';
}

/** Other attempts kept changing the same records. The caller may run the step again. */
export class ConcurrentArenaUpdateError extends Error {
  override name = 'ConcurrentArenaUpdateError';
}

export interface ArenaResult {
  xpGained: number;
  /** Progress before and after, so callers can tell which badges and ranks are new. */
  before: ChallengerProgress;
  after: ChallengerProgress;
}

export interface ArenaVerdict {
  attemptId: string;
  outcome: AttemptOutcome;
  recordedAt: string;
}

const MAX_TRANSACTION_ATTEMPTS = 3;

/**
 * Records the judged outcome of an attempt: the attempt result, the
 * challenger's XP and stats, both leaderboards, the category and the global
 * stats change in one transaction. The challenger version guards against a
 * concurrent attempt by the same challenger; on a conflict everything is read
 * again and the transaction retried. Recording the same attempt twice returns
 * the first result, so a retried workflow step changes nothing.
 */
export async function recordArenaResult(
  table: StoreTable,
  verdict: ArenaVerdict,
): Promise<ArenaResult> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt++) {
    const stored = await getAttempt(table, verdict.attemptId);
    if (stored.result) return toArenaResult(stored.result);
    const result = await tryRecord(table, verdict, stored);
    if (result) return result;
  }
  throw new ConcurrentArenaUpdateError(
    `Attempt ${verdict.attemptId} conflicted ${MAX_TRANSACTION_ATTEMPTS} times while recording`,
  );
}

async function getAttempt(table: StoreTable, attemptId: string): Promise<StoredAttempt> {
  const { Item } = await table.client.send(
    new GetCommand({ TableName: table.name, Key: attemptKey(attemptId), ConsistentRead: true }),
  );
  if (!Item) throw new ArenaRecordNotFoundError(`Attempt ${attemptId} does not exist`);
  return storedAttemptSchema.parse(Item);
}

/** Returns undefined when another writer got there first. */
async function tryRecord(
  table: StoreTable,
  verdict: ArenaVerdict,
  attempt: StoredAttempt,
): Promise<ArenaResult | undefined> {
  const [challengerItem, categoryItem] = await Promise.all(
    [challengerKey(attempt.challengerId), categoryKey(attempt.category)].map(async (Key) => {
      const { Item } = await table.client.send(
        new GetCommand({ TableName: table.name, Key, ConsistentRead: true }),
      );
      return Item;
    }),
  );
  if (!challengerItem) {
    throw new ArenaRecordNotFoundError(`Challenger ${attempt.challengerId} does not exist`);
  }
  const challenger = challengerSchema.parse(challengerItem);
  const category = categoryStatsSchema.parse(categoryItem ?? {});
  const loophole = verdict.outcome.result === 'loophole';
  const firstInCategory = loophole && category.firstFinderId === null;
  const { progress: after, xpGained } = applyAttempt(challenger.progress, {
    category: attempt.category,
    channel: attempt.channel,
    outcome: verdict.outcome,
    firstInCategory,
    dailyChallengeDate: attempt.dailyChallengeDate,
  });
  const result = { xpGained, before: challenger.progress, after };
  const entry = { challengerId: challenger.id, handle: challenger.handle };
  const allTime = { kind: 'all-time' } as const;
  const daily = attempt.dailyChallengeDate
    ? ({ kind: 'daily', date: attempt.dailyChallengeDate } as const)
    : null;

  const writes = [
    {
      Update: {
        TableName: table.name,
        Key: attemptKey(verdict.attemptId),
        UpdateExpression: 'SET #result = :result',
        ConditionExpression: 'attribute_exists(pk) AND attribute_not_exists(#result)',
        ExpressionAttributeNames: { '#result': 'result' },
        ExpressionAttributeValues: {
          ':result': { outcome: verdict.outcome, ...result, recordedAt: verdict.recordedAt },
        },
      },
    },
    {
      Put: {
        TableName: table.name,
        Item: {
          ...challengerKey(challenger.id),
          ...challenger,
          version: challenger.version + 1,
          progress: after,
        },
        ConditionExpression: 'version = :version',
        ExpressionAttributeValues: { ':version': challenger.version },
      },
    },
    {
      Delete: {
        TableName: table.name,
        Key: leaderboardKey(allTime, challenger.progress.xp, challenger.id),
      },
    },
    {
      Put: {
        TableName: table.name,
        Item: { ...leaderboardKey(allTime, after.xp, challenger.id), ...entry, xp: after.xp },
      },
    },
    ...(daily ? dailyLeaderboardWrites(table, daily, challenger.progress, after, entry) : []),
    {
      Update: {
        TableName: table.name,
        Key: categoryKey(attempt.category),
        UpdateExpression: firstInCategory
          ? 'ADD attempts :one, loopholes :loopholes SET firstFinderId = :finder'
          : 'ADD attempts :one, loopholes :loopholes',
        // Two first finders racing: the loser's transaction fails and its retry is no longer first.
        ...(firstInCategory ? { ConditionExpression: 'attribute_not_exists(firstFinderId)' } : {}),
        ExpressionAttributeValues: {
          ':one': 1,
          ':loopholes': Number(loophole),
          ...(firstInCategory ? { ':finder': challenger.id } : {}),
        },
      },
    },
    ...[globalStatsKey, dailyStatsKey(verdict.recordedAt.slice(0, 10))].map((Key) => ({
      Update: {
        TableName: table.name,
        Key,
        UpdateExpression: 'ADD attempts :one, held :held',
        ExpressionAttributeValues: { ':one': 1, ':held': Number(!loophole) },
      },
    })),
  ];

  try {
    await table.client.send(new TransactWriteCommand({ TransactItems: writes }));
    return result;
  } catch (error) {
    if (isConflict(error)) return undefined;
    throw error;
  }
}

function dailyLeaderboardWrites(
  table: StoreTable,
  daily: { kind: 'daily'; date: string },
  before: ChallengerProgress,
  after: ChallengerProgress,
  entry: { challengerId: string; handle: string },
) {
  const dailyXp = after.daily?.xp ?? 0;
  const replaces = before.daily?.date === daily.date;
  return [
    ...(replaces && before.daily
      ? [
          {
            Delete: {
              TableName: table.name,
              Key: leaderboardKey(daily, before.daily.xp, entry.challengerId),
            },
          },
        ]
      : []),
    {
      Put: {
        TableName: table.name,
        Item: { ...leaderboardKey(daily, dailyXp, entry.challengerId), ...entry, xp: dailyXp },
      },
    },
  ];
}

function isConflict(error: unknown): boolean {
  return (
    error instanceof TransactionCanceledException &&
    (error.CancellationReasons ?? []).some(
      (reason) => reason.Code === 'ConditionalCheckFailed' || reason.Code === 'TransactionConflict',
    )
  );
}

function toArenaResult(stored: z.infer<typeof arenaResultSchema>): ArenaResult {
  return { xpGained: stored.xpGained, before: stored.before, after: stored.after };
}
