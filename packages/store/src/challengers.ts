import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { attackCategories, newChallengerProgress } from '@handshake/arena';
import { z } from 'zod';
import { accountKey } from './accounts';
import type { StoreTable } from './table';

export const challengerKey = (challengerId: string) => ({
  pk: `CHALLENGER#${challengerId}`,
  sk: 'META',
});

const count = z.number().int().nonnegative();

export const challengerProgressSchema = z.object({
  xp: count,
  stats: z.object({
    loopholes: count,
    firstLoopholeCategories: count,
    categoriesTried: z.array(z.enum(attackCategories)).readonly(),
    textLoopholes: count,
    evidenceLoopholes: count,
    longestHeldStreak: count,
    regressionsHolding: count,
    dailyChallengeDays: count,
  }),
  currentHeldStreak: count,
  daily: z.object({ date: z.iso.date(), xp: count }).nullable(),
});

export const challengerSchema = z.object({
  id: z.string().min(1),
  handle: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  /** Grows by one with every recorded attempt, so concurrent writers cannot both win. */
  version: count,
  progress: challengerProgressSchema,
});

export type Challenger = z.infer<typeof challengerSchema>;

export async function getChallenger(
  table: StoreTable,
  challengerId: string,
): Promise<Challenger | undefined> {
  const { Item } = await table.client.send(
    new GetCommand({ TableName: table.name, Key: challengerKey(challengerId) }),
  );
  return Item ? challengerSchema.parse(Item) : undefined;
}

export class HandleTakenError extends Error {
  override name = 'HandleTakenError';
}

/** The account is not approved yet, or it already has a challenger. */
export class ChallengerNotAllowedError extends Error {
  override name = 'ChallengerNotAllowedError';
}

// Handles that differ only in case would look the same on the leaderboard.
const handleKey = (handle: string) => ({ pk: `HANDLE#${handle.toLowerCase()}`, sk: 'META' });

export interface NewChallenger {
  challengerId: string;
  accountId: string;
  handle: string;
  createdAt: Date;
}

/**
 * Reserves the handle, creates the challenger and links it to the account in
 * one transaction. Only an approved account without a challenger gets one.
 */
export async function createChallenger(
  table: StoreTable,
  input: NewChallenger,
): Promise<Challenger> {
  const challenger: Challenger = {
    id: input.challengerId,
    handle: input.handle,
    createdAt: input.createdAt.toISOString(),
    version: 0,
    progress: newChallengerProgress,
  };
  try {
    await table.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: table.name,
              Item: { ...handleKey(input.handle), challengerId: input.challengerId },
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
          {
            Put: {
              TableName: table.name,
              Item: { ...challengerKey(input.challengerId), ...challenger },
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
          {
            Update: {
              TableName: table.name,
              Key: accountKey(input.accountId),
              UpdateExpression: 'SET challengerId = :challengerId',
              ConditionExpression: '#access = :approved AND attribute_not_exists(challengerId)',
              ExpressionAttributeNames: { '#access': 'access' },
              ExpressionAttributeValues: {
                ':challengerId': input.challengerId,
                ':approved': 'approved',
              },
            },
          },
        ],
      }),
    );
  } catch (error) {
    if (!(error instanceof TransactionCanceledException)) throw error;
    const [handle, , account] = error.CancellationReasons ?? [];
    if (account?.Code === 'ConditionalCheckFailed') {
      throw new ChallengerNotAllowedError(`Account ${input.accountId} may not pick a handle`);
    }
    if (handle?.Code === 'ConditionalCheckFailed') {
      throw new HandleTakenError(`The handle ${input.handle} is taken`);
    }
    throw error;
  }
  return challenger;
}
