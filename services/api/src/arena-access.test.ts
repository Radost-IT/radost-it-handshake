import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccountFromSession, requestAccessFromSession } from './arena-access';
import {
  arenaTestContext,
  mockSignedIn,
  sessionCookies,
  testAccount,
  stubZeptoMail,
} from './arena-test-context';

const dynamodb = mockClient(DynamoDBDocumentClient);
let sentEmails: ReturnType<typeof stubZeptoMail>;
const context = arenaTestContext('2026-10-03T12:30:00Z');
const newAccount = {
  id: 'account-1',
  email: 'ada@example.com',
  createdAt: testAccount.createdAt,
  access: 'none',
};
const ask = (reason: string) =>
  requestAccessFromSession(context, { body: JSON.stringify({ reason }), cookies: sessionCookies });

beforeEach(() => {
  dynamodb.reset();
  sentEmails = stubZeptoMail();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getAccountFromSession', () => {
  it('returns the access status and the challenger', async () => {
    mockSignedIn(dynamodb);

    const response = await getAccountFromSession(context, sessionCookies);

    expect(JSON.parse(response.body ?? '')).toMatchObject({
      email: 'ada@example.com',
      access: 'approved',
      challenger: { id: 'challenger-1', handle: 'tester' },
    });
  });

  it('returns no challenger before a handle is picked', async () => {
    mockSignedIn(dynamodb, newAccount);

    const response = await getAccountFromSession(context, sessionCookies);

    expect(JSON.parse(response.body ?? '')).toMatchObject({ access: 'none', challenger: null });
  });

  it('asks to sign in without a session', async () => {
    const response = await getAccountFromSession(context, []);

    expect(response.statusCode).toBe(401);
  });
});

describe('requestAccessFromSession', () => {
  it('stores the reason and emails the request with the approve command', async () => {
    mockSignedIn(dynamodb, newAccount);
    dynamodb.on(UpdateCommand).resolves({});

    const response = await ask('  I build payment agents and want to test them.  ');

    expect(response.statusCode).toBe(202);
    expect(
      dynamodb.commandCalls(UpdateCommand)[0]?.args[0].input.ExpressionAttributeValues?.[':reason'],
    ).toBe('I build payment agents and want to test them.');
    const email = sentEmails()[0];
    expect(email?.to).toBe('admin@example.com');
    expect(email?.text).toContain('pnpm arena:access T approve ada@example.com');
  });

  it('asks for a longer reason', async () => {
    mockSignedIn(dynamodb, newAccount);

    const response = await ask('let me in');

    expect(response.statusCode).toBe(400);
    expect(sentEmails()).toHaveLength(0);
  });

  it('refuses a second request', async () => {
    mockSignedIn(dynamodb, { ...newAccount, access: 'pending' });
    dynamodb
      .on(UpdateCommand)
      .rejects(new ConditionalCheckFailedException({ message: 'failed', $metadata: {} }));

    const response = await ask('I build payment agents and want to test them.');

    expect(response.statusCode).toBe(409);
    expect(sentEmails()).toHaveLength(0);
  });
});
