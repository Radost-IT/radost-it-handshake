import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { newChallengerProgress } from '@handshake/arena';
import { z } from 'zod';
import { challengerKey, type Challenger } from './challengers';
import type { StoreTable } from './table';

export class HandleTakenError extends Error {
  override name = 'HandleTakenError';
}

// Handles differ only in case would look the same on the leaderboard.
const handleKey = (handle: string) => ({ pk: `HANDLE#${handle.toLowerCase()}`, sk: 'META' });
const sessionKey = (tokenHash: string) => ({ pk: `SESSION#${tokenHash}`, sk: 'META' });

export interface NewChallenger {
  challengerId: string;
  handle: string;
  /** SHA-256 of the session token. The token itself is never stored. */
  sessionTokenHash: string;
  createdAt: Date;
  sessionExpiresAt: Date;
}

const epochSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** Reserves the handle, creates the challenger and opens a session in one transaction. */
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
            Put: {
              TableName: table.name,
              Item: {
                ...sessionKey(input.sessionTokenHash),
                challengerId: input.challengerId,
                ttl: epochSeconds(input.sessionExpiresAt),
              },
            },
          },
        ],
      }),
    );
  } catch (error) {
    const handleTaken =
      error instanceof TransactionCanceledException &&
      error.CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed';
    if (handleTaken) throw new HandleTakenError(`The handle ${input.handle} is taken`);
    throw error;
  }
  return challenger;
}

const sessionSchema = z.object({ challengerId: z.string().min(1), ttl: z.number().int() });

/** Returns the challenger a session belongs to, or undefined for an unknown or expired one. */
export async function findSessionChallengerId(
  table: StoreTable,
  sessionTokenHash: string,
  now: Date,
): Promise<string | undefined> {
  const { Item } = await table.client.send(
    new GetCommand({ TableName: table.name, Key: sessionKey(sessionTokenHash) }),
  );
  if (!Item) return undefined;
  const session = sessionSchema.parse(Item);
  // DynamoDB deletes expired items only eventually, so expiry is checked here too.
  return session.ttl > epochSeconds(now) ? session.challengerId : undefined;
}
