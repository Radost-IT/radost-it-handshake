import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountIdForEmail, hashSignInCode } from '@handshake/store';
import { refreshSession, requestSignInCode, signOut, verifySignInCode } from './arena-sign-in';
import { arenaTestContext, testAccount, stubZeptoMail } from './arena-test-context';
import { hashToken } from './http';

const dynamodb = mockClient(DynamoDBDocumentClient);
let sentEmails: ReturnType<typeof stubZeptoMail>;
const context = arenaTestContext('2026-10-03T12:30:00Z');
const accountId = accountIdForEmail('ada@example.com');
const signIn = (body: unknown) =>
  requestSignInCode(context, { body: JSON.stringify(body), sourceIp: '203.0.113.7' });
const verify = (body: unknown) =>
  verifySignInCode(context, { body: JSON.stringify(body), sourceIp: '203.0.113.7' });
const judgeId = accountIdForEmail('judge-1@example.com');
const mockJudgeAccount = () => {
  dynamodb.on(GetCommand, { Key: { pk: `ACCOUNT#${judgeId}`, sk: 'META' } }).resolves({
    Item: {
      id: judgeId,
      email: 'judge-1@example.com',
      createdAt: '2026-10-05T09:00:00.000Z',
      access: 'approved',
      fixedSignInCodeHash: hashSignInCode(judgeId, '424242'),
    },
  });
};
const rejectRateLimits = () => {
  dynamodb
    .on(UpdateCommand)
    .rejects(new ConditionalCheckFailedException({ message: 'failed', $metadata: {} }));
};
const rateLimitSubjects = () =>
  dynamodb.commandCalls(UpdateCommand).map((call): unknown => call.args[0].input.Key?.pk);

beforeEach(() => {
  dynamodb.reset();
  dynamodb.on(GetCommand).resolves({});
  dynamodb.on(UpdateCommand).resolves({});
  dynamodb.on(PutCommand).resolves({});
  sentEmails = stubZeptoMail();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestSignInCode', () => {
  it('stores only a hash of the code and emails the code', async () => {
    const response = await signIn({ email: ' Ada@Example.com ' });

    expect(response.statusCode).toBe(202);
    const stored = dynamodb.commandCalls(PutCommand)[0]?.args[0].input.Item;
    expect(stored?.pk).toBe(`SIGNIN#${accountId}`);
    expect(JSON.stringify(stored)).not.toContain('123456');
    const email = sentEmails()[0];
    expect(email?.to).toBe('ada@example.com');
    expect(email?.text).toContain('123456');
  });

  it('limits codes per email and per network, by the hour and by the day', async () => {
    rejectRateLimits();

    const response = await signIn({ email: 'ada@example.com' });

    expect(response.statusCode).toBe(429);
    expect(sentEmails()).toHaveLength(0);
    const ipSubject = `RATE#signin-ip#${hashToken('203.0.113.7')}`;
    expect(rateLimitSubjects()).toEqual([
      `RATE#signin-email#${accountId}`,
      `RATE#signin-email#${accountId}`,
      ipSubject,
      ipSubject,
    ]);
    expect(
      dynamodb.commandCalls(UpdateCommand).map((call): unknown => call.args[0].input.Key?.sk),
    ).toEqual([
      'WINDOW#2026-10-03T12',
      'WINDOW#2026-10-03',
      'WINDOW#2026-10-03T12',
      'WINDOW#2026-10-03',
    ]);
  });

  it('stops sending emails once the day has used its share', async () => {
    dynamodb
      .on(UpdateCommand, { Key: { pk: 'RATE#signin-emails', sk: 'WINDOW#2026-10-03' } })
      .rejects(new ConditionalCheckFailedException({ message: 'failed', $metadata: {} }));

    const response = await signIn({ email: 'ada@example.com' });

    expect(response.statusCode).toBe(429);
    expect(sentEmails()).toHaveLength(0);
    expect(dynamodb.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('sends no email to a judge, who has a fixed code', async () => {
    mockJudgeAccount();

    const response = await signIn({ email: 'judge-1@example.com' });

    expect(response.statusCode).toBe(202);
    expect(sentEmails()).toHaveLength(0);
    expect(dynamodb.commandCalls(PutCommand)).toHaveLength(0);
    expect(rateLimitSubjects()).not.toContain('RATE#signin-emails');
  });

  it('rejects an invalid email', async () => {
    const response = await signIn({ email: 'ada' });

    expect(response.statusCode).toBe(400);
  });
});

const issuedTokens = {
  accessToken: 'hs_session_token-1',
  refreshToken: 'session-1.token-1',
  accessTokenExpiresAt: '2026-10-03T13:30:00.000Z',
};

describe('verifySignInCode', () => {
  const live = { codeHash: hashToken(`${accountId}:123456`), failedChecks: 0, ttl: 1_900_000_000 };

  it('opens a session for a valid code and returns its tokens', async () => {
    dynamodb.on(GetCommand, { Key: { pk: `SIGNIN#${accountId}`, sk: 'META' } }).resolves({
      Item: live,
    });
    dynamodb.on(DeleteCommand).resolves({});
    dynamodb.on(UpdateCommand).resolves({ Attributes: { ...testAccount, access: 'none' } });
    dynamodb.on(TransactWriteCommand).resolves({});

    const response = await verify({ email: 'ada@example.com', code: '123456' });

    expect(response.statusCode).toBe(200);
    expect(response.cookies).toBeUndefined();
    expect(JSON.parse(response.body ?? '')).toEqual({ access: 'none', session: issuedTokens });
    const writes = dynamodb.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems;
    expect(writes?.map((write) => write.Put?.Item)).toEqual([
      {
        pk: 'SESSION#session-1',
        sk: 'META',
        accountId,
        refreshTokenHash: hashToken('session-1.token-1'),
        accessTokenHash: hashToken('hs_session_token-1'),
        ttl: Date.parse('2026-11-02T12:30:00Z') / 1000,
      },
      {
        pk: `ACCESS_TOKEN#${hashToken('hs_session_token-1')}`,
        sk: 'META',
        accountId,
        sessionId: 'session-1',
        ttl: Date.parse('2026-10-03T13:30:00Z') / 1000,
      },
    ]);
  });

  it('explains a wrong code without opening a session', async () => {
    dynamodb.on(GetCommand, { Key: { pk: `SIGNIN#${accountId}`, sk: 'META' } }).resolves({
      Item: live,
    });

    const response = await verify({ email: 'ada@example.com', code: '654321' });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body ?? '')).toEqual({ error: 'This code is wrong' });
    expect(dynamodb.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it('signs a judge in with the fixed code, which works again', async () => {
    mockJudgeAccount();
    dynamodb.on(UpdateCommand).resolves({ Attributes: { ...testAccount, access: 'approved' } });
    dynamodb.on(TransactWriteCommand).resolves({});

    const first = await verify({ email: 'Judge-1@Example.com', code: '424242' });
    const second = await verify({ email: 'judge-1@example.com', code: '424242' });

    for (const response of [first, second]) {
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body ?? '')).toEqual({
        access: 'approved',
        session: issuedTokens,
      });
    }
    expect(dynamodb.commandCalls(DeleteCommand)).toHaveLength(0);
  });

  it('refuses a wrong code for a judge', async () => {
    mockJudgeAccount();

    const response = await verify({ email: 'judge-1@example.com', code: '123456' });

    expect(response.statusCode).toBe(400);
    expect(dynamodb.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it('limits tries per email and per network before reading the code', async () => {
    rejectRateLimits();

    const response = await verify({ email: 'judge-1@example.com', code: '424242' });

    expect(response.statusCode).toBe(429);
    expect(dynamodb.commandCalls(GetCommand)).toHaveLength(0);
    expect(rateLimitSubjects()).toEqual([
      `RATE#signin-check-email#${judgeId}`,
      `RATE#signin-check-ip#${hashToken('203.0.113.7')}`,
    ]);
  });
});

const mockStoredSession = (refreshToken = 'session-1.token-1') => {
  dynamodb.on(GetCommand, { Key: { pk: 'SESSION#session-1', sk: 'META' } }).resolves({
    Item: {
      accountId,
      refreshTokenHash: hashToken(refreshToken),
      accessTokenHash: 'old-access-hash',
      ttl: 1_900_000_000,
    },
  });
};
const refresh = (refreshToken: unknown) =>
  refreshSession(context, JSON.stringify({ refreshToken }));

describe('refreshSession', () => {
  it('swaps the refresh token for a new pair and drops the old access token', async () => {
    mockStoredSession('session-1.old-secret');
    dynamodb.on(TransactWriteCommand).resolves({});

    const response = await refresh('session-1.old-secret');

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? '')).toEqual({ session: issuedTokens });
    const writes = dynamodb.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems;
    expect(writes?.[0]?.Update?.ConditionExpression).toBe('refreshTokenHash = :presented');
    expect(writes?.[0]?.Update?.ExpressionAttributeValues).toMatchObject({
      ':presented': hashToken('session-1.old-secret'),
      ':next': hashToken('session-1.token-1'),
    });
    expect(writes?.[2]?.Delete?.Key).toEqual({ pk: 'ACCESS_TOKEN#old-access-hash', sk: 'META' });
  });

  it('ends the whole session when an old refresh token comes back', async () => {
    mockStoredSession('session-1.current-secret');
    dynamodb.on(TransactWriteCommand).resolves({});

    const response = await refresh('session-1.stolen-secret');

    expect(response.statusCode).toBe(401);
    const writes = dynamodb.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems;
    expect(writes?.map((write) => write.Delete?.Key)).toEqual([
      { pk: 'SESSION#session-1', sk: 'META' },
      { pk: 'ACCESS_TOKEN#old-access-hash', sk: 'META' },
    ]);
  });

  it('refuses an unknown session and a malformed token', async () => {
    dynamodb.on(GetCommand).resolves({});

    expect((await refresh('session-1.token-1')).statusCode).toBe(401);
    expect((await refresh('not a token')).statusCode).toBe(401);
    expect(dynamodb.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });
});

describe('signOut', () => {
  it('deletes the session and its access token', async () => {
    mockStoredSession();
    dynamodb.on(TransactWriteCommand).resolves({});

    const response = await signOut(context, JSON.stringify({ refreshToken: 'session-1.token-1' }));

    expect(response.statusCode).toBe(204);
    const writes = dynamodb.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems;
    expect(writes?.map((write) => write.Delete?.Key)).toEqual([
      { pk: 'SESSION#session-1', sk: 'META' },
      { pk: 'ACCESS_TOKEN#old-access-hash', sk: 'META' },
    ]);
  });

  it('leaves the session alone for a refresh token that is not its current one', async () => {
    mockStoredSession();

    const response = await signOut(context, JSON.stringify({ refreshToken: 'session-1.guess' }));

    expect(response.statusCode).toBe(204);
    expect(dynamodb.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });
});
