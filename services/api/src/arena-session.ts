import { SESv2Client } from '@aws-sdk/client-sesv2';
import type { SFNClient } from '@aws-sdk/client-sfn';
import {
  findSessionAccountId,
  getAccount,
  getChallenger,
  type Account,
  type Challenger,
  type StoreTable,
} from '@handshake/store';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { hashToken, json } from './http';

export interface ArenaApiContext {
  table: StoreTable;
  now: () => Date;
  newChallengerId: () => string;
  /** A random, unguessable token. Only its hash is stored. */
  newSessionToken: () => string;
  /** Six random digits for the sign-in email. Only their hash is stored. */
  newSignInCode: () => string;
  newAttemptId: () => string;
  stepFunctions: SFNClient;
  arenaRunArn: string;
  /** LLM tokens allowed per UTC day; new attempts are refused once they are used. */
  dailyTokenBudget: number;
  mail: { client: SESv2Client; from: string; adminEmail: string };
}

// The __Host- prefix makes browsers refuse the cookie unless it is Secure,
// host-only and set for the whole path, so no other subdomain can plant one.
export const SESSION_COOKIE = '__Host-handshake_account';
export const SESSION_DAYS = 90;
const DAY_SECONDS = 24 * 60 * 60;

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Max-Age=${SESSION_DAYS * DAY_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

export const expiredSessionCookie = `${SESSION_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`;

/** API Gateway passes cookies as `name=value` strings. */
export function readSessionToken(cookies: readonly string[]): string | undefined {
  const prefix = `${SESSION_COOKIE}=`;
  return cookies.find((cookie) => cookie.startsWith(prefix))?.slice(prefix.length) || undefined;
}

type Lookup<T> = { found: true } & T;
type Refusal = { found: false; response: APIGatewayProxyStructuredResultV2 };

const refuse = (statusCode: number, error: string): Refusal => ({
  found: false,
  response: json(statusCode, { error }),
});

export async function findSessionAccount(
  context: ArenaApiContext,
  cookies: readonly string[],
): Promise<Lookup<{ account: Account }> | Refusal> {
  const token = readSessionToken(cookies);
  if (!token) return refuse(401, 'Sign in with your email first');
  const accountId = await findSessionAccountId(context.table, hashToken(token), context.now());
  const account = accountId ? await getAccount(context.table, accountId) : undefined;
  if (!account) return refuse(401, 'Your session has ended. Sign in again');
  return { found: true, account };
}

/** The challenger of a signed-in, approved account that has picked a handle. */
export async function findSessionChallenger(
  context: ArenaApiContext,
  cookies: readonly string[],
): Promise<Lookup<{ challenger: Challenger }> | Refusal> {
  const session = await findSessionAccount(context, cookies);
  if (!session.found) return session;
  const { account } = session;
  if (account.access !== 'approved') return refuse(403, 'Your arena access is not approved');
  const challenger = account.challengerId
    ? await getChallenger(context.table, account.challengerId)
    : undefined;
  if (!challenger) return refuse(403, 'Pick a handle first');
  return { found: true, challenger };
}
