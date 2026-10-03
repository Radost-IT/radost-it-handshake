import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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
  /** Why the judge decided this way. A loophole's regression case keeps it. */
  rationale: z.string().min(1),
  nearDuplicateOf: z.string().nullable(),
  recordedAt: z.iso.datetime({ offset: true }),
});

/** What happened when the attempt ran, kept for the judge and the attempt replay. */
export const arenaRunSchema = z.object({
  transcript: z.string().min(1),
  policyDecisions: z.array(z.string().min(1)),
});

export type ArenaRun = z.infer<typeof arenaRunSchema>;

export const storedAttemptSchema = z.object({
  id: z.string().min(1),
  challengerId: z.string().min(1),
  category: z.enum(attackCategories),
  channel: z.enum(['listing', 'message', 'evidence']),
  attackText: z.string().min(1),
  dailyChallengeDate: z.iso.date().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  run: arenaRunSchema.optional(),
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

export async function getArenaAttempt(
  table: StoreTable,
  attemptId: string,
): Promise<StoredAttempt | undefined> {
  const { Item } = await table.client.send(
    new GetCommand({ TableName: table.name, Key: attemptKey(attemptId), ConsistentRead: true }),
  );
  return Item ? storedAttemptSchema.parse(Item) : undefined;
}

export async function saveArenaRun(
  table: StoreTable,
  attemptId: string,
  run: ArenaRun,
): Promise<void> {
  await table.client.send(
    new UpdateCommand({
      TableName: table.name,
      Key: attemptKey(attemptId),
      UpdateExpression: 'SET #run = :run',
      ConditionExpression: 'attribute_exists(pk)',
      ExpressionAttributeNames: { '#run': 'run' },
      ExpressionAttributeValues: { ':run': run },
    }),
  );
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
