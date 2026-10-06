import type { ArenaMailConfig } from '@handshake/config';
import type { SFNClient } from '@aws-sdk/client-sfn';
import {
  findAccessTokenAccountId,
  getAccount,
  getChallenger,
  type Account,
  type Challenger,
  type SessionTokens,
  type StoreTable,
} from '@handshake/store';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { hashToken, json, readBearerToken } from './http';

export interface ArenaApiContext {
  table: StoreTable;
  now: () => Date;
  newChallengerId: () => string;
  /** A random, unguessable secret for session tokens. Only hashes of the tokens are stored. */
  newSessionToken: () => string;
  newSessionId: () => string;
  /** Six random digits for the sign-in email. Only their hash is stored. */
  newSignInCode: () => string;
  newAttemptId: () => string;
  stepFunctions: SFNClient;
  arenaRunArn: string;
  /** LLM tokens allowed per UTC day; new attempts are refused once they are used. */
  dailyTokenBudget: number;
  mail: ArenaMailConfig;
}

/** Access tokens carry this prefix, so the Deal API can tell them from API keys and deal tokens. */
export const ACCESS_TOKEN_PREFIX = 'hs_session_';
const ACCESS_TOKEN_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_MS = 30 * 24 * 60 * 60 * 1000;

/** What the browser keeps after signing in. */
export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
}

/** New tokens for the session, and the hashes the store keeps of them. */
export function issueSessionTokens(
  context: ArenaApiContext,
  sessionId: string,
  now: Date,
): { issued: IssuedTokens; stored: SessionTokens } {
  const accessToken = `${ACCESS_TOKEN_PREFIX}${context.newSessionToken()}`;
  const refreshToken = `${sessionId}.${context.newSessionToken()}`;
  const accessExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_MS);
  return {
    issued: { accessToken, refreshToken, accessTokenExpiresAt: accessExpiresAt.toISOString() },
    stored: {
      sessionId,
      refreshTokenHash: hashToken(refreshToken),
      refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_MS),
      accessTokenHash: hashToken(accessToken),
      accessExpiresAt,
    },
  };
}

const refreshTokenSchema = z
  .string()
  .regex(/^[\w-]{1,64}\.[\w-]{1,128}$/)
  .transform((token) => ({ sessionId: token.slice(0, token.indexOf('.')), token }));

/** The session a refresh token belongs to, or undefined for a malformed one. */
export function readRefreshToken(token: unknown): { sessionId: string; token: string } | undefined {
  const parsed = refreshTokenSchema.safeParse(token);
  return parsed.success ? parsed.data : undefined;
}

/** The access token in an `Authorization: Bearer` header, or undefined for any other credential. */
export function readAccessToken(authorization: string | undefined): string | undefined {
  const token = readBearerToken(authorization);
  return token?.startsWith(ACCESS_TOKEN_PREFIX) ? token : undefined;
}

type Lookup<T> = { found: true } & T;
type Refusal = { found: false; response: APIGatewayProxyStructuredResultV2 };

const refuse = (statusCode: number, error: string): Refusal => ({
  found: false,
  response: json(statusCode, { error }),
});

export async function findSessionAccount(
  context: ArenaApiContext,
  authorization: string | undefined,
): Promise<Lookup<{ account: Account }> | Refusal> {
  const token = readAccessToken(authorization);
  if (!token) return refuse(401, 'Sign in with your email first');
  const accountId = await findAccessTokenAccountId(context.table, hashToken(token), context.now());
  const account = accountId ? await getAccount(context.table, accountId) : undefined;
  if (!account) return refuse(401, 'Your session has ended. Sign in again');
  return { found: true, account };
}

/** The challenger of a signed-in, approved account that has picked a handle. */
export async function findSessionChallenger(
  context: ArenaApiContext,
  authorization: string | undefined,
): Promise<Lookup<{ challenger: Challenger }> | Refusal> {
  const session = await findSessionAccount(context, authorization);
  if (!session.found) return session;
  const { account } = session;
  if (account.access !== 'approved') return refuse(403, 'Your arena access is not approved');
  const challenger = account.challengerId
    ? await getChallenger(context.table, account.challengerId)
    : undefined;
  if (!challenger) return refuse(403, 'Pick a handle first');
  return { found: true, challenger };
}
