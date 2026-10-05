import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { createChallengerFromRequest } from './arena-challengers';
import { arenaTestContext, mockSignedIn, sessionCookies, testAccount } from './arena-test-context';

const dynamodb = mockClient(DynamoDBDocumentClient);
const context = arenaTestContext('2026-10-02T12:00:00Z');
const pick = (body: string) =>
  createChallengerFromRequest(context, { body, cookies: sessionCookies });
const cancelled = (codes: string[]) =>
  new TransactionCanceledException({
    message: 'Transaction cancelled',
    $metadata: {},
    CancellationReasons: codes.map((Code) => ({ Code })),
  });

beforeEach(() => {
  dynamodb.reset();
  mockSignedIn(dynamodb, { ...testAccount, challengerId: undefined });
});

describe('createChallengerFromRequest', () => {
  it('creates the challenger for the signed-in account', async () => {
    dynamodb.on(TransactWriteCommand).resolves({});

    const response = await pick('{"handle":" Tester "}');

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body ?? '')).toMatchObject({
      id: 'challenger-1',
      handle: 'Tester',
      xp: 0,
      rank: { rank: 'Observer' },
      badges: [],
    });
    const writes = dynamodb.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems;
    expect(writes?.[2]?.Update?.Key).toEqual({ pk: 'ACCOUNT#account-1', sk: 'META' });
  });

  it('asks to sign in without a session', async () => {
    const response = await createChallengerFromRequest(context, {
      body: '{"handle":"Tester"}',
      cookies: [],
    });

    expect(response.statusCode).toBe(401);
  });

  it('explains why a handle is not allowed', async () => {
    const response = await pick('{"handle":"PayPal_Support"}');

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body ?? '')).toEqual({ error: 'This handle is reserved' });
  });

  it('rejects a body that is not JSON', async () => {
    const response = await pick('handle=tester');

    expect(response.statusCode).toBe(400);
  });

  it('reports a taken handle', async () => {
    dynamodb
      .on(TransactWriteCommand)
      .rejects(cancelled(['ConditionalCheckFailed', 'None', 'None']));

    const response = await pick('{"handle":"Tester"}');

    expect(response.statusCode).toBe(409);
  });

  it('refuses an account that is not approved', async () => {
    dynamodb
      .on(TransactWriteCommand)
      .rejects(cancelled(['None', 'None', 'ConditionalCheckFailed']));

    const response = await pick('{"handle":"Tester"}');

    expect(response.statusCode).toBe(403);
  });
});
