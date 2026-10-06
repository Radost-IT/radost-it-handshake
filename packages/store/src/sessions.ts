import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import type { StoreTable } from './table';

const sessionKey = (sessionId: string) => ({ pk: `SESSION#${sessionId}`, sk: 'META' });
const accessTokenKey = (tokenHash: string) => ({ pk: `ACCESS_TOKEN#${tokenHash}`, sk: 'META' });

const epochSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

/**
 * One signed-in device. The refresh token proves the device owns the session;
 * the short-lived access token signs each API call. Only token hashes are stored.
 */
export interface SessionTokens {
  sessionId: string;
  refreshTokenHash: string;
  refreshExpiresAt: Date;
  accessTokenHash: string;
  accessExpiresAt: Date;
}

const sessionSchema = z.object({
  accountId: z.string().min(1),
  refreshTokenHash: z.string().min(1),
  accessTokenHash: z.string().min(1),
  ttl: z.number().int(),
});

const accessTokenSchema = z.object({ accountId: z.string().min(1), ttl: z.number().int() });

function putAccessToken(table: StoreTable, accountId: string, tokens: SessionTokens) {
  return {
    Put: {
      TableName: table.name,
      Item: {
        ...accessTokenKey(tokens.accessTokenHash),
        accountId,
        sessionId: tokens.sessionId,
        ttl: epochSeconds(tokens.accessExpiresAt),
      },
    },
  };
}

export async function openSession(
  table: StoreTable,
  accountId: string,
  tokens: SessionTokens,
): Promise<void> {
  await table.client.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: table.name,
            Item: {
              ...sessionKey(tokens.sessionId),
              accountId,
              refreshTokenHash: tokens.refreshTokenHash,
              accessTokenHash: tokens.accessTokenHash,
              ttl: epochSeconds(tokens.refreshExpiresAt),
            },
          },
        },
        putAccessToken(table, accountId, tokens),
      ],
    }),
  );
}

async function getSession(table: StoreTable, sessionId: string, now: Date) {
  const { Item } = await table.client.send(
    new GetCommand({ TableName: table.name, Key: sessionKey(sessionId) }),
  );
  if (!Item) return undefined;
  const session = sessionSchema.parse(Item);
  // DynamoDB deletes expired items only eventually, so expiry is checked here too.
  return session.ttl > epochSeconds(now) ? session : undefined;
}

async function deleteSession(
  table: StoreTable,
  sessionId: string,
  accessTokenHash: string,
): Promise<void> {
  await table.client.send(
    new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: table.name, Key: sessionKey(sessionId) } },
        { Delete: { TableName: table.name, Key: accessTokenKey(accessTokenHash) } },
      ],
    }),
  );
}

export type SessionRotation =
  { rotated: true; accountId: string } | { rotated: false; reason: 'unknown' | 'reused' | 'raced' };

/**
 * Swaps the session's tokens for new ones. A refresh token that was already
 * swapped means someone replays a stolen copy, so the whole session ends.
 */
export async function rotateSession(
  table: StoreTable,
  presentedRefreshTokenHash: string,
  tokens: SessionTokens,
  now: Date,
): Promise<SessionRotation> {
  const session = await getSession(table, tokens.sessionId, now);
  if (!session) return { rotated: false, reason: 'unknown' };
  if (session.refreshTokenHash !== presentedRefreshTokenHash) {
    await deleteSession(table, tokens.sessionId, session.accessTokenHash);
    return { rotated: false, reason: 'reused' };
  }
  try {
    await table.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: table.name,
              Key: sessionKey(tokens.sessionId),
              UpdateExpression:
                'SET refreshTokenHash = :next, accessTokenHash = :access, #ttl = :ttl',
              ConditionExpression: 'refreshTokenHash = :presented',
              ExpressionAttributeNames: { '#ttl': 'ttl' },
              ExpressionAttributeValues: {
                ':next': tokens.refreshTokenHash,
                ':access': tokens.accessTokenHash,
                ':ttl': epochSeconds(tokens.refreshExpiresAt),
                ':presented': presentedRefreshTokenHash,
              },
            },
          },
          putAccessToken(table, session.accountId, tokens),
          { Delete: { TableName: table.name, Key: accessTokenKey(session.accessTokenHash) } },
        ],
      }),
    );
  } catch (error) {
    // Another request swapped the same token a moment earlier.
    if (error instanceof TransactionCanceledException) return { rotated: false, reason: 'raced' };
    throw error;
  }
  return { rotated: true, accountId: session.accountId };
}

/** Ends the session and its current access token. Unknown sessions are ignored. */
export async function closeSession(
  table: StoreTable,
  sessionId: string,
  refreshTokenHash: string,
  now: Date,
): Promise<void> {
  const session = await getSession(table, sessionId, now);
  if (session?.refreshTokenHash !== refreshTokenHash) return;
  await deleteSession(table, sessionId, session.accessTokenHash);
}

/** Returns the account an access token belongs to, or undefined for an unknown or expired one. */
export async function findAccessTokenAccountId(
  table: StoreTable,
  tokenHash: string,
  now: Date,
): Promise<string | undefined> {
  const { Item } = await table.client.send(
    new GetCommand({ TableName: table.name, Key: accessTokenKey(tokenHash) }),
  );
  if (!Item) return undefined;
  const token = accessTokenSchema.parse(Item);
  return token.ttl > epochSeconds(now) ? token.accountId : undefined;
}
