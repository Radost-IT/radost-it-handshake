import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeSession, findAccessTokenAccountId, rotateSession } from './sessions';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };
const now = new Date('2026-10-02T12:00:00Z');
const later = (seconds: number) => now.getTime() / 1000 + seconds;

const nextTokens = {
  sessionId: 'session-1',
  refreshTokenHash: 'refresh-2',
  refreshExpiresAt: new Date('2026-11-01T12:00:00Z'),
  accessTokenHash: 'access-2',
  accessExpiresAt: new Date('2026-10-02T13:00:00Z'),
};

const mockSession = (ttl = later(60)) => {
  dynamodb.on(GetCommand, { Key: { pk: 'SESSION#session-1', sk: 'META' } }).resolves({
    Item: {
      accountId: 'account-1',
      refreshTokenHash: 'refresh-1',
      accessTokenHash: 'access-1',
      ttl,
    },
  });
};

beforeEach(() => dynamodb.reset());

describe('rotateSession', () => {
  it('swaps both tokens when the presented refresh token is the current one', async () => {
    mockSession();
    dynamodb.on(TransactWriteCommand).resolves({});

    await expect(rotateSession(table, 'refresh-1', nextTokens, now)).resolves.toEqual({
      rotated: true,
      accountId: 'account-1',
    });
    const writes = dynamodb.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems;
    expect(writes?.[1]?.Put?.Item).toMatchObject({
      pk: 'ACCESS_TOKEN#access-2',
      accountId: 'account-1',
    });
    expect(writes?.[2]?.Delete?.Key).toEqual({ pk: 'ACCESS_TOKEN#access-1', sk: 'META' });
  });

  it('ends the session when a swapped refresh token is replayed', async () => {
    mockSession();
    dynamodb.on(TransactWriteCommand).resolves({});

    await expect(rotateSession(table, 'refresh-0', nextTokens, now)).resolves.toEqual({
      rotated: false,
      reason: 'reused',
    });
    const writes = dynamodb.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems;
    expect(writes?.map((write) => write.Delete?.Key)).toEqual([
      { pk: 'SESSION#session-1', sk: 'META' },
      { pk: 'ACCESS_TOKEN#access-1', sk: 'META' },
    ]);
  });

  it('keeps the session when another request swapped the token first', async () => {
    mockSession();
    dynamodb
      .on(TransactWriteCommand)
      .rejects(new TransactionCanceledException({ message: 'cancelled', $metadata: {} }));

    await expect(rotateSession(table, 'refresh-1', nextTokens, now)).resolves.toEqual({
      rotated: false,
      reason: 'raced',
    });
  });

  it('refuses an expired session that DynamoDB has not deleted yet', async () => {
    mockSession(later(-1));

    await expect(rotateSession(table, 'refresh-1', nextTokens, now)).resolves.toEqual({
      rotated: false,
      reason: 'unknown',
    });
    expect(dynamodb.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });
});

describe('closeSession', () => {
  it('deletes the session and its access token', async () => {
    mockSession();
    dynamodb.on(TransactWriteCommand).resolves({});

    await closeSession(table, 'session-1', 'refresh-1', now);

    const writes = dynamodb.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems;
    expect(writes?.map((write) => write.Delete?.Key)).toEqual([
      { pk: 'SESSION#session-1', sk: 'META' },
      { pk: 'ACCESS_TOKEN#access-1', sk: 'META' },
    ]);
  });

  it('ignores a refresh token that is not the current one', async () => {
    mockSession();

    await closeSession(table, 'session-1', 'refresh-0', now);

    expect(dynamodb.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });
});

describe('findAccessTokenAccountId', () => {
  it('returns the account of a live access token', async () => {
    dynamodb.on(GetCommand).resolves({ Item: { accountId: 'account-1', ttl: later(60) } });

    await expect(findAccessTokenAccountId(table, 'access-1', now)).resolves.toBe('account-1');
  });

  it('ignores an expired access token that DynamoDB has not deleted yet', async () => {
    dynamodb.on(GetCommand).resolves({ Item: { accountId: 'account-1', ttl: later(-1) } });

    await expect(findAccessTokenAccountId(table, 'access-1', now)).resolves.toBeUndefined();
  });

  it('returns undefined for an unknown access token', async () => {
    dynamodb.on(GetCommand).resolves({});

    await expect(findAccessTokenAccountId(table, 'access-1', now)).resolves.toBeUndefined();
  });
});
