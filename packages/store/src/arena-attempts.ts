import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { attackCategories, type AttackCategory, type AttackChannel } from '@handshake/arena';
import { z } from 'zod';
import { challengerProgressSchema } from './challengers';
import type { StoreTable } from './table';

export const attemptKey = (attemptId: string) => ({ pk: `ATTEMPT#${attemptId}`, sk: 'META' });

const challengerHistoryPartition = (challengerId: string) => `CHALLENGER#${challengerId}`;

// The attempt ID keeps two attempts in the same millisecond apart; the timestamp sorts them.
const challengerHistoryKey = (challengerId: string, createdAt: string, attemptId: string) => ({
  gsi1pk: challengerHistoryPartition(challengerId),
  gsi1sk: `ATTEMPT#${createdAt}#${attemptId}`,
});

const attemptOutcomeSchema = z.discriminatedUnion('result', [
  z.object({ result: z.literal('held') }),
  z.object({
    result: z.literal('loophole'),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    novelty: z.number().min(0).max(1),
    nearDuplicate: z.boolean(),
  }),
]);

export const arenaResultSchema = z.object({
  outcome: attemptOutcomeSchema,
  xpGained: z.number().int().nonnegative(),
  before: challengerProgressSchema,
  after: challengerProgressSchema,
  recordedAt: z.iso.datetime({ offset: true }),
});

export const storedAttemptSchema = z.object({
  id: z.string().min(1),
  challengerId: z.string().min(1),
  category: z.enum(attackCategories),
  channel: z.enum(['listing', 'message', 'evidence']),
  attackText: z.string().min(1),
  dailyChallengeDate: z.iso.date().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  result: arenaResultSchema.optional(),
});

export type StoredAttempt = z.infer<typeof storedAttemptSchema>;

export interface NewArenaAttempt {
  id: string;
  challengerId: string;
  category: AttackCategory;
  channel: AttackChannel;
  attackText: string;
  dailyChallengeDate: string | null;
  createdAt: string;
}

export class AttemptExistsError extends Error {
  override name = 'AttemptExistsError';
}

/** Stores a new attempt before it runs. The GSI1 keys put it in the challenger's history. */
export async function createArenaAttempt(
  table: StoreTable,
  attempt: NewArenaAttempt,
): Promise<void> {
  try {
    await table.client.send(
      new PutCommand({
        TableName: table.name,
        Item: {
          ...attemptKey(attempt.id),
          ...challengerHistoryKey(attempt.challengerId, attempt.createdAt, attempt.id),
          ...attempt,
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      throw new AttemptExistsError(`Attempt ${attempt.id} already exists`);
    }
    throw error;
  }
}

/** The challenger's attempts, newest first. */
export async function listChallengerAttempts(
  table: StoreTable,
  challengerId: string,
  limit: number,
): Promise<StoredAttempt[]> {
  const { Items = [] } = await table.client.send(
    new QueryCommand({
      TableName: table.name,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': challengerHistoryPartition(challengerId) },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return Items.map((item) => storedAttemptSchema.parse(item));
}
