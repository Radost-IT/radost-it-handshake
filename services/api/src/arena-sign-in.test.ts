import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountIdForEmail, hashSignInCode } from '@handshake/store';
import { requestSignInCode, signOut, verifySignInCode } from './arena-sign-in';
import { arenaTestContext, sessionCookies, testAccount, stubZeptoMail } from './arena-test-context';
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

  it('limits codes per email and per network', async () => {
    rejectRateLimits();

    const response = await signIn({ email: 'ada@example.com' });

    expect(response.statusCode).toBe(429);
    expect(sentEmails()).toHaveLength(0);
    expect(rateLimitSubjects()).toEqual([
      `RATE#signin-email#${accountId}`,
      `RATE#signin-ip#${hashToken('203.0.113.7')}`,
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

describe('verifySignInCode', () => {
  const live = { codeHash: hashToken(`${accountId}:123456`), failedChecks: 0, ttl: 1_900_000_000 };

  it('opens a session for a valid code and sets the cookie', async () => {
    dynamodb.on(GetCommand, { Key: { pk: `SIGNIN#${accountId}`, sk: 'META' } }).resolves({
      Item: live,
    });
    dynamodb.on(DeleteCommand).resolves({});
    dynamodb.on(UpdateCommand).resolves({ Attributes: { ...testAccount, access: 'none' } });

    const response = await verify({ email: 'ada@example.com', code: '123456' });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? '')).toEqual({ access: 'none' });
    expect(response.cookies?.[0]).toMatch(
      /^__Host-handshake_account=token-1; Max-Age=7776000; Path=\/; Secure; HttpOnly/,
    );
    expect(dynamodb.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({
      pk: `SESSION#${hashToken('token-1')}`,
      accountId,
    });
  });

  it('explains a wrong code without opening a session', async () => {
    dynamodb.on(GetCommand, { Key: { pk: `SIGNIN#${accountId}`, sk: 'META' } }).resolves({
      Item: live,
    });

    const response = await verify({ email: 'ada@example.com', code: '654321' });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body ?? '')).toEqual({ error: 'This code is wrong' });
    expect(dynamodb.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('signs a judge in with the fixed code, which works again', async () => {
    mockJudgeAccount();
    dynamodb.on(UpdateCommand).resolves({ Attributes: { ...testAccount, access: 'approved' } });

    const first = await verify({ email: 'Judge-1@Example.com', code: '424242' });
    const second = await verify({ email: 'judge-1@example.com', code: '424242' });

    for (const response of [first, second]) {
      expect(response.statusCode).toBe(200);
      expect(response.cookies?.[0]).toMatch(/^__Host-handshake_account=token-1;/);
    }
    expect(dynamodb.commandCalls(DeleteCommand)).toHaveLength(0);
  });

  it('refuses a wrong code for a judge', async () => {
    mockJudgeAccount();

    const response = await verify({ email: 'judge-1@example.com', code: '123456' });

    expect(response.statusCode).toBe(400);
    expect(dynamodb.commandCalls(PutCommand)).toHaveLength(0);
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

describe('signOut', () => {
  it('deletes the session and clears the cookie', async () => {
    dynamodb.on(DeleteCommand).resolves({});

    const response = await signOut(context, sessionCookies);

    expect(response.statusCode).toBe(204);
    expect(response.cookies?.[0]).toContain('Max-Age=0');
    expect(dynamodb.commandCalls(DeleteCommand)[0]?.args[0].input.Key).toEqual({
      pk: `SESSION#${hashToken('token-1')}`,
      sk: 'META',
    });
  });
});
