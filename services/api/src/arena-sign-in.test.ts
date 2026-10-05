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
import { accountIdForEmail, hashPassword } from '@handshake/store';
import { requestSignInCode, signInWithPassword, signOut, verifySignInCode } from './arena-sign-in';
import { arenaTestContext, sessionCookies, testAccount, stubZeptoMail } from './arena-test-context';
import { hashToken } from './http';

const dynamodb = mockClient(DynamoDBDocumentClient);
let sentEmails: ReturnType<typeof stubZeptoMail>;
const context = arenaTestContext('2026-10-03T12:30:00Z');
const accountId = accountIdForEmail('ada@example.com');
const signIn = (body: unknown) =>
  requestSignInCode(context, { body: JSON.stringify(body), sourceIp: '203.0.113.7' });

beforeEach(() => {
  dynamodb.reset();
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
    dynamodb
      .on(UpdateCommand)
      .rejects(new ConditionalCheckFailedException({ message: 'failed', $metadata: {} }));

    const response = await signIn({ email: 'ada@example.com' });

    expect(response.statusCode).toBe(429);
    expect(sentEmails()).toHaveLength(0);
    const subjects = dynamodb
      .commandCalls(UpdateCommand)
      .map((call): unknown => call.args[0].input.Key?.pk);
    expect(subjects).toEqual([
      `RATE#signin-email#${accountId}`,
      `RATE#signin-ip#${hashToken('203.0.113.7')}`,
    ]);
  });

  it('rejects an invalid email', async () => {
    const response = await signIn({ email: 'ada' });

    expect(response.statusCode).toBe(400);
  });
});

describe('verifySignInCode', () => {
  const live = { codeHash: hashToken(`${accountId}:123456`), failedChecks: 0, ttl: 1_900_000_000 };

  it('opens a session for a valid code and sets the cookie', async () => {
    dynamodb.on(GetCommand).resolves({ Item: live });
    dynamodb.on(DeleteCommand).resolves({});
    dynamodb.on(UpdateCommand).resolves({ Attributes: { ...testAccount, access: 'none' } });

    const response = await verifySignInCode(
      context,
      JSON.stringify({ email: 'ada@example.com', code: '123456' }),
    );

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
    dynamodb.on(GetCommand).resolves({ Item: live });

    const response = await verifySignInCode(
      context,
      JSON.stringify({ email: 'ada@example.com', code: '654321' }),
    );

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body ?? '')).toEqual({ error: 'This code is wrong' });
    expect(dynamodb.commandCalls(PutCommand)).toHaveLength(0);
  });
});

describe('signInWithPassword', () => {
  const judgesId = accountIdForEmail('judges@example.com');
  const passwordSignIn = (body: unknown) =>
    signInWithPassword(context, { body: JSON.stringify(body), sourceIp: '203.0.113.7' });
  const mockJudgesAccount = (account: Record<string, unknown>) => {
    dynamodb.on(GetCommand, { Key: { pk: `ACCOUNT#${judgesId}`, sk: 'META' } }).resolves({
      Item: {
        id: judgesId,
        email: 'judges@example.com',
        createdAt: '2026-10-05T09:00:00.000Z',
        access: 'approved',
        ...account,
      },
    });
  };

  it('opens a session for the right password', async () => {
    mockJudgesAccount({ passwordHash: await hashPassword('long-random-password') });

    const response = await passwordSignIn({
      email: 'Judges@Example.com',
      password: 'long-random-password',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? '')).toEqual({ access: 'approved' });
    expect(response.cookies?.[0]).toMatch(/^__Host-handshake_account=token-1;/);
    expect(dynamodb.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({
      pk: `SESSION#${hashToken('token-1')}`,
      accountId: judgesId,
    });
  });

  it('refuses a wrong password and an account that signs in with codes', async () => {
    mockJudgesAccount({ passwordHash: await hashPassword('long-random-password') });
    const wrong = await passwordSignIn({ email: 'judges@example.com', password: 'guess' });
    mockJudgesAccount({});
    const noPassword = await passwordSignIn({ email: 'judges@example.com', password: 'guess' });

    for (const response of [wrong, noPassword]) {
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body ?? '')).toEqual({
        error: 'This email and password do not match',
      });
    }
    expect(dynamodb.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('limits tries per email and per network', async () => {
    dynamodb
      .on(UpdateCommand)
      .rejects(new ConditionalCheckFailedException({ message: 'failed', $metadata: {} }));

    const response = await passwordSignIn({ email: 'judges@example.com', password: 'guess' });

    expect(response.statusCode).toBe(429);
    expect(dynamodb.commandCalls(GetCommand)).toHaveLength(0);
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
