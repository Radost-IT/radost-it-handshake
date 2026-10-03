import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  accountIdForEmail,
  decideAccess,
  listPendingAccessRequests,
  requestAccess,
  upsertAccount,
} from './accounts';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };
const now = new Date('2026-10-02T12:00:00Z');

const account = {
  id: 'account-1',
  email: 'ada@example.com',
  createdAt: '2026-10-01T12:00:00.000Z',
  access: 'none',
};
const conditionFailed = () =>
  new ConditionalCheckFailedException({ message: 'failed', $metadata: {} });

beforeEach(() => dynamodb.reset());

describe('accountIdForEmail', () => {
  it('gives the same account for any spelling of the email', () => {
    expect(accountIdForEmail(' Ada@Example.com ')).toBe(accountIdForEmail('ada@example.com'));
  });
});

describe('upsertAccount', () => {
  it('keeps the first sign-in date and the access status of a known account', async () => {
    dynamodb.on(UpdateCommand).resolves({ Attributes: { ...account, access: 'approved' } });

    const stored = await upsertAccount(table, {
      accountId: 'account-1',
      email: 'ada@example.com',
      signedInAt: now,
    });

    expect(stored.access).toBe('approved');
    const update = dynamodb.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(update?.UpdateExpression).toContain('createdAt = if_not_exists(createdAt, :now)');
    expect(update?.UpdateExpression).toContain('#access = if_not_exists(#access, :none)');
  });
});

describe('requestAccess', () => {
  it('marks the account pending and lists it for review', async () => {
    dynamodb.on(UpdateCommand).resolves({});

    await expect(
      requestAccess(table, 'account-1', { reason: 'I test payment agents', requestedAt: now }),
    ).resolves.toBe(true);

    const update = dynamodb.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(update?.ConditionExpression).toBe('#access = :none');
    expect(update?.ExpressionAttributeValues).toMatchObject({
      ':list': 'ACCESS#pending',
      ':sort': `${now.toISOString()}#account-1`,
    });
  });

  it('refuses a second request', async () => {
    dynamodb.on(UpdateCommand).rejects(conditionFailed());

    await expect(
      requestAccess(table, 'account-1', { reason: 'Again', requestedAt: now }),
    ).resolves.toBe(false);
  });
});

describe('decideAccess', () => {
  it('approves a pending request and removes it from the review list', async () => {
    dynamodb.on(UpdateCommand).resolves({ Attributes: { ...account, access: 'approved' } });

    const decided = await decideAccess(table, 'account-1', { access: 'approved', decidedAt: now });

    expect(decided?.access).toBe('approved');
    const update = dynamodb.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(update?.UpdateExpression).toContain('REMOVE gsi1pk, gsi1sk');
    expect(update?.ConditionExpression).toBe('#access = :pending');
  });

  it('returns undefined when nothing is pending', async () => {
    dynamodb.on(UpdateCommand).rejects(conditionFailed());

    await expect(
      decideAccess(table, 'account-1', { access: 'rejected', decidedAt: now }),
    ).resolves.toBeUndefined();
  });
});

describe('listPendingAccessRequests', () => {
  it('reads the review list from the index', async () => {
    dynamodb.on(QueryCommand).resolves({ Items: [{ ...account, access: 'pending' }] });

    await expect(listPendingAccessRequests(table)).resolves.toHaveLength(1);
    expect(dynamodb.commandCalls(QueryCommand)[0]?.args[0].input).toMatchObject({
      IndexName: 'GSI1',
      ExpressionAttributeValues: { ':pk': 'ACCESS#pending' },
    });
  });
});
