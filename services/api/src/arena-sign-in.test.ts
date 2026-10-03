import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountIdForEmail } from '@handshake/store';
import { requestSignInCode, signOut, verifySignInCode } from './arena-sign-in';
import { arenaTestContext, sessionCookies, testAccount } from './arena-test-context';
import { hashToken } from './http';

const dynamodb = mockClient(DynamoDBDocumentClient);
const ses = mockClient(SESv2Client);
const context = arenaTestContext('2026-10-03T12:30:00Z');
const accountId = accountIdForEmail('ada@example.com');
const signIn = (body: unknown) =>
  requestSignInCode(context, { body: JSON.stringify(body), sourceIp: '203.0.113.7' });

beforeEach(() => {
  dynamodb.reset();
  ses.reset();
  dynamodb.on(UpdateCommand).resolves({});
  dynamodb.on(PutCommand).resolves({});
  ses.on(SendEmailCommand).resolves({});
});

describe('requestSignInCode', () => {
  it('stores only a hash of the code and emails the code', async () => {
    const response = await signIn({ email: ' Ada@Example.com ' });

    expect(response.statusCode).toBe(202);
    const stored = dynamodb.commandCalls(PutCommand)[0]?.args[0].input.Item;
    expect(stored?.pk).toBe(`SIGNIN#${accountId}`);
    expect(JSON.stringify(stored)).not.toContain('123456');
    const email = ses.commandCalls(SendEmailCommand)[0]?.args[0].input;
    expect(email?.Destination?.ToAddresses).toEqual(['ada@example.com']);
    expect(email?.Content?.Simple?.Body?.Text?.Data).toContain('123456');
  });

  it('limits codes per email and per network', async () => {
    dynamodb
      .on(UpdateCommand)
      .rejects(new ConditionalCheckFailedException({ message: 'failed', $metadata: {} }));

    const response = await signIn({ email: 'ada@example.com' });

    expect(response.statusCode).toBe(429);
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
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
