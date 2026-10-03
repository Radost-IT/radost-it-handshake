import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeSession, findSessionAccountId, openSession } from './sessions';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };
const now = new Date('2026-10-02T12:00:00Z');

beforeEach(() => dynamodb.reset());

describe('openSession', () => {
  it('stores only the token hash with the account and an expiry', async () => {
    dynamodb.on(PutCommand).resolves({});

    await openSession(table, {
      tokenHash: 'hash-1',
      accountId: 'account-1',
      expiresAt: new Date('2026-12-31T12:00:00Z'),
    });

    expect(dynamodb.commandCalls(PutCommand)[0]?.args[0].input.Item).toEqual({
      pk: 'SESSION#hash-1',
      sk: 'META',
      accountId: 'account-1',
      ttl: Date.parse('2026-12-31T12:00:00Z') / 1000,
    });
  });
});

describe('closeSession', () => {
  it('deletes the session', async () => {
    dynamodb.on(DeleteCommand).resolves({});

    await closeSession(table, 'hash-1');

    expect(dynamodb.commandCalls(DeleteCommand)[0]?.args[0].input.Key).toEqual({
      pk: 'SESSION#hash-1',
      sk: 'META',
    });
  });
});

describe('findSessionAccountId', () => {
  it('returns the account of a live session', async () => {
    dynamodb.on(GetCommand).resolves({
      Item: { accountId: 'account-1', ttl: now.getTime() / 1000 + 60 },
    });

    await expect(findSessionAccountId(table, 'hash-1', now)).resolves.toBe('account-1');
  });

  it('ignores an expired session that DynamoDB has not deleted yet', async () => {
    dynamodb.on(GetCommand).resolves({
      Item: { accountId: 'account-1', ttl: now.getTime() / 1000 - 1 },
    });

    await expect(findSessionAccountId(table, 'hash-1', now)).resolves.toBeUndefined();
  });

  it('returns undefined for an unknown session', async () => {
    dynamodb.on(GetCommand).resolves({});

    await expect(findSessionAccountId(table, 'hash-1', now)).resolves.toBeUndefined();
  });
});
