import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { StoreTable } from './table';

/** The account ID is the SHA-256 of the lowercase email, so a sign-in finds it without an index. */
export function accountIdForEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

export const accountKey = (accountId: string) => ({ pk: `ACCOUNT#${accountId}`, sk: 'META' });

const PENDING_REQUESTS = 'ACCESS#pending';

export const accessStatuses = ['none', 'pending', 'approved', 'rejected'] as const;
export type AccessStatus = (typeof accessStatuses)[number];

export const accountSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
  createdAt: z.iso.datetime({ offset: true }),
  access: z.enum(accessStatuses),
  /** Why the person wants to join, in their own words. */
  reason: z.string().optional(),
  requestedAt: z.iso.datetime({ offset: true }).optional(),
  decidedAt: z.iso.datetime({ offset: true }).optional(),
  /** Set once the approved person picks a handle. */
  challengerId: z.string().min(1).optional(),
  /** Only accounts the operator creates with a password have one, such as the judges' account. */
  passwordHash: z.string().min(1).optional(),
});

export type Account = z.infer<typeof accountSchema>;

export interface SignedInEmail {
  accountId: string;
  email: string;
  signedInAt: Date;
}

/** Creates the account on the first sign-in and returns it as stored. */
export async function upsertAccount(table: StoreTable, input: SignedInEmail): Promise<Account> {
  const { Attributes } = await table.client.send(
    new UpdateCommand({
      TableName: table.name,
      Key: accountKey(input.accountId),
      UpdateExpression:
        'SET id = :id, email = :email, createdAt = if_not_exists(createdAt, :now), #access = if_not_exists(#access, :none)',
      ExpressionAttributeNames: { '#access': 'access' },
      ExpressionAttributeValues: {
        ':id': input.accountId,
        ':email': input.email,
        ':now': input.signedInAt.toISOString(),
        ':none': 'none',
      },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return accountSchema.parse(Attributes);
}

export async function getAccount(
  table: StoreTable,
  accountId: string,
): Promise<Account | undefined> {
  const { Item } = await table.client.send(
    new GetCommand({ TableName: table.name, Key: accountKey(accountId) }),
  );
  return Item ? accountSchema.parse(Item) : undefined;
}

/**
 * Stores the request to join and lists it for review. Returns false when the
 * account already asked, was approved or was turned down.
 */
export async function requestAccess(
  table: StoreTable,
  accountId: string,
  request: { reason: string; requestedAt: Date },
): Promise<boolean> {
  const requestedAt = request.requestedAt.toISOString();
  try {
    await table.client.send(
      new UpdateCommand({
        TableName: table.name,
        Key: accountKey(accountId),
        UpdateExpression:
          'SET #access = :pending, reason = :reason, requestedAt = :at, gsi1pk = :list, gsi1sk = :sort',
        ConditionExpression: '#access = :none',
        ExpressionAttributeNames: { '#access': 'access' },
        ExpressionAttributeValues: {
          ':pending': 'pending',
          ':none': 'none',
          ':reason': request.reason,
          ':at': requestedAt,
          ':list': PENDING_REQUESTS,
          ':sort': `${requestedAt}#${accountId}`,
        },
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return false;
    throw error;
  }
}

/** Approves or turns down a pending request. Returns undefined when nothing is pending. */
export async function decideAccess(
  table: StoreTable,
  accountId: string,
  decision: { access: 'approved' | 'rejected'; decidedAt: Date },
): Promise<Account | undefined> {
  try {
    const { Attributes } = await table.client.send(
      new UpdateCommand({
        TableName: table.name,
        Key: accountKey(accountId),
        UpdateExpression: 'SET #access = :decision, decidedAt = :at REMOVE gsi1pk, gsi1sk',
        ConditionExpression: '#access = :pending',
        ExpressionAttributeNames: { '#access': 'access' },
        ExpressionAttributeValues: {
          ':decision': decision.access,
          ':at': decision.decidedAt.toISOString(),
          ':pending': 'pending',
        },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return accountSchema.parse(Attributes);
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return undefined;
    throw error;
  }
}

/** Pending requests to join, oldest first. */
export async function listPendingAccessRequests(table: StoreTable): Promise<Account[]> {
  const { Items = [] } = await table.client.send(
    new QueryCommand({
      TableName: table.name,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': PENDING_REQUESTS },
    }),
  );
  return Items.map((item) => accountSchema.parse(item));
}
