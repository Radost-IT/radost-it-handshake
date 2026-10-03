import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import type { StoreTable } from './table';

const sessionKey = (tokenHash: string) => ({ pk: `SESSION#${tokenHash}`, sk: 'META' });

const epochSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

export interface NewSession {
  /** SHA-256 of the session token. The token itself is never stored. */
  tokenHash: string;
  accountId: string;
  expiresAt: Date;
}

export async function openSession(table: StoreTable, session: NewSession): Promise<void> {
  await table.client.send(
    new PutCommand({
      TableName: table.name,
      Item: {
        ...sessionKey(session.tokenHash),
        accountId: session.accountId,
        ttl: epochSeconds(session.expiresAt),
      },
    }),
  );
}

export async function closeSession(table: StoreTable, tokenHash: string): Promise<void> {
  await table.client.send(new DeleteCommand({ TableName: table.name, Key: sessionKey(tokenHash) }));
}

const sessionSchema = z.object({ accountId: z.string().min(1), ttl: z.number().int() });

/** Returns the account a session belongs to, or undefined for an unknown or expired one. */
export async function findSessionAccountId(
  table: StoreTable,
  tokenHash: string,
  now: Date,
): Promise<string | undefined> {
  const { Item } = await table.client.send(
    new GetCommand({ TableName: table.name, Key: sessionKey(tokenHash) }),
  );
  if (!Item) return undefined;
  const session = sessionSchema.parse(Item);
  // DynamoDB deletes expired items only eventually, so expiry is checked here too.
  return session.ttl > epochSeconds(now) ? session.accountId : undefined;
}
