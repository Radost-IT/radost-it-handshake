import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SFNClient } from '@aws-sdk/client-sfn';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { newChallengerProgress } from '@handshake/arena';
import type { AwsClientStub } from 'aws-sdk-client-mock';
import { vi } from 'vitest';
import { hashToken } from './http';
import type { ArenaApiContext } from './arena-session';

export const testArenaRunArn =
  'arn:aws:states:eu-west-1:123456789012:stateMachine:Handshake-prod-ArenaRun';

export function arenaTestContext(now: string): ArenaApiContext {
  return {
    table: { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' },
    now: () => new Date(now),
    newChallengerId: () => 'challenger-1',
    newSessionToken: () => 'token-1',
    newSessionId: () => 'session-1',
    newSignInCode: () => '123456',
    newAttemptId: () => 'attempt-1',
    stepFunctions: new SFNClient({}),
    arenaRunArn: testArenaRunArn,
    dailyTokenBudget: 1000,
    mail: {
      from: 'arena@example.com',
      adminEmail: 'admin@example.com',
      zeptoMail: { apiUrl: 'https://api.zeptomail.eu', token: 'Zoho-enczapikey test-token' },
    },
  };
}

export const sessionAuthorization = 'Bearer hs_session_token-1';

export const testAccount = {
  id: 'account-1',
  email: 'ada@example.com',
  createdAt: '2026-10-01T09:00:00.000Z',
  access: 'approved',
  challengerId: 'challenger-1',
};

/** Mocks the reads behind `hs_session_token-1`: its access token, the account and the account's challenger. */
export function mockSignedIn(
  dynamodb: AwsClientStub<DynamoDBDocumentClient>,
  account: Record<string, unknown> = testAccount,
): void {
  dynamodb
    .on(GetCommand, { Key: { pk: `ACCESS_TOKEN#${hashToken('hs_session_token-1')}`, sk: 'META' } })
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

/** Stubs the ZeptoMail API and returns the recipient and text of each email sent. */
export function stubZeptoMail(): () => { to: string; text: string }[] {
  const fetch = vi.fn<(url: URL, init: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(Response.json({ message: 'OK' }, { status: 201 })),
  );
  vi.stubGlobal('fetch', fetch);
  return () =>
    fetch.mock.calls.map(([, init]) => {
      const body = JSON.parse(init.body as string) as {
        to: { email_address: { address: string } }[];
        textbody: string;
      };
      return {
        to: body.to.map(({ email_address }) => email_address.address).join(','),
        text: body.textbody,
      };
    });
}
