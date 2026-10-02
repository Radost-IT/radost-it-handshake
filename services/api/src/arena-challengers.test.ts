import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { newChallengerProgress } from '@handshake/arena';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createChallengerFromRequest,
  getChallengerFromSession,
  hashSessionToken,
  SESSION_COOKIE,
  type ArenaApiContext,
} from './arena-challengers';

const dynamodb = mockClient(DynamoDBDocumentClient);
const context: ArenaApiContext = {
  table: { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' },
  now: () => new Date('2026-10-02T12:00:00Z'),
  newChallengerId: () => 'challenger-1',
  newSessionToken: () => 'token-1',
};

beforeEach(() => dynamodb.reset());

describe('createChallengerFromRequest', () => {
  it('creates the challenger and sets a session cookie holding the token', async () => {
    dynamodb.on(TransactWriteCommand).resolves({});

    const response = await createChallengerFromRequest(context, '{"handle":" Tester "}');

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body ?? '')).toMatchObject({
      id: 'challenger-1',
      handle: 'Tester',
      xp: 0,
      rank: { rank: 'Newcomer' },
      badges: [],
    });
    expect(response.cookies?.[0]).toMatch(
      new RegExp(`^${SESSION_COOKIE}=token-1; Max-Age=7776000; Path=/; Secure; HttpOnly`),
    );
    const writes = dynamodb.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems;
    expect(writes?.[2]?.Put?.Item?.pk).toBe(`SESSION#${hashSessionToken('token-1')}`);
    expect(JSON.stringify(writes)).not.toContain('token-1');
  });

  it('explains why a handle is not allowed', async () => {
    const response = await createChallengerFromRequest(context, '{"handle":"PayPal_Support"}');

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body ?? '')).toEqual({ error: 'This handle is reserved' });
  });

  it('rejects a body that is not JSON', async () => {
    const response = await createChallengerFromRequest(context, 'handle=tester');
    expect(response.statusCode).toBe(400);
  });

  it('reports a taken handle', async () => {
    dynamodb.on(TransactWriteCommand).rejects(
      new TransactionCanceledException({
        message: 'Transaction cancelled',
        $metadata: {},
        CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
      }),
    );

    const response = await createChallengerFromRequest(context, '{"handle":"tester"}');

    expect(response.statusCode).toBe(409);
  });
});

describe('getChallengerFromSession', () => {
  const sessionKey = { pk: `SESSION#${hashSessionToken('token-1')}`, sk: 'META' };

  it('returns the challenger of the session cookie', async () => {
    dynamodb
      .on(GetCommand, { Key: sessionKey })
      .resolves({ Item: { challengerId: 'challenger-1', ttl: 1_900_000_000 } });
    dynamodb.on(GetCommand, { Key: { pk: 'CHALLENGER#challenger-1', sk: 'META' } }).resolves({
      Item: {
        id: 'challenger-1',
        handle: 'tester',
        createdAt: '2026-10-01T09:00:00Z',
        version: 3,
        progress: { ...newChallengerProgress, xp: 60 },
      },
    });

    const response = await getChallengerFromSession(context, [
      'theme=dark',
      `${SESSION_COOKIE}=token-1`,
    ]);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? '')).toMatchObject({
      handle: 'tester',
      xp: 60,
      rank: { rank: 'Explorer' },
    });
  });

  it('asks for a handle when there is no session cookie', async () => {
    const response = await getChallengerFromSession(context, ['theme=dark']);

    expect(response.statusCode).toBe(401);
    expect(dynamodb.calls()).toHaveLength(0);
  });

  it('rejects an unknown session', async () => {
    dynamodb.on(GetCommand).resolves({});

    const response = await getChallengerFromSession(context, [`${SESSION_COOKIE}=forged`]);

    expect(response.statusCode).toBe(401);
  });
});
