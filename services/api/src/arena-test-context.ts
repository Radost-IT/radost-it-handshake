import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { SFNClient } from '@aws-sdk/client-sfn';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { newChallengerProgress } from '@handshake/arena';
import type { AwsClientStub } from 'aws-sdk-client-mock';
import { hashToken } from './http';
import { SESSION_COOKIE, type ArenaApiContext } from './arena-session';

export const testArenaRunArn =
  'arn:aws:states:eu-west-1:123456789012:stateMachine:Handshake-prod-ArenaRun';

export function arenaTestContext(now: string): ArenaApiContext {
  return {
    table: { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' },
    now: () => new Date(now),
    newChallengerId: () => 'challenger-1',
    newSessionToken: () => 'token-1',
    newSignInCode: () => '123456',
    newAttemptId: () => 'attempt-1',
    stepFunctions: new SFNClient({}),
    arenaRunArn: testArenaRunArn,
    dailyTokenBudget: 1000,
    mail: {
      client: new SESv2Client({}),
      from: 'arena@example.com',
      adminEmail: 'admin@example.com',
    },
  };
}

export const sessionCookies = [`${SESSION_COOKIE}=token-1`];

export const testAccount = {
  id: 'account-1',
  email: 'ada@example.com',
  createdAt: '2026-10-01T09:00:00.000Z',
  access: 'approved',
  challengerId: 'challenger-1',
};

/** Mocks the reads behind `token-1`: its session, the account and the account's challenger. */
export function mockSignedIn(
  dynamodb: AwsClientStub<DynamoDBDocumentClient>,
  account: Record<string, unknown> = testAccount,
): void {
  dynamodb
    .on(GetCommand, { Key: { pk: `SESSION#${hashToken('token-1')}`, sk: 'META' } })
    .resolves({ Item: { accountId: 'account-1', ttl: 1_900_000_000 } });
  dynamodb
    .on(GetCommand, { Key: { pk: 'ACCOUNT#account-1', sk: 'META' } })
    .resolves({ Item: account });
  dynamodb.on(GetCommand, { Key: { pk: 'CHALLENGER#challenger-1', sk: 'META' } }).resolves({
    Item: {
      id: 'challenger-1',
      handle: 'tester',
      createdAt: '2026-10-01T09:00:00Z',
      version: 1,
      progress: newChallengerProgress,
    },
  });
}
