import { rankProgress, unlockedBadges, validateHandle } from '@handshake/arena';
import {
  createChallenger,
  findSessionChallengerId,
  getChallenger,
  HandleTakenError,
  type Challenger,
  type StoreTable,
} from '@handshake/store';
import type { SFNClient } from '@aws-sdk/client-sfn';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { hashToken, json, parseJson } from './http';

export interface ArenaApiContext {
  table: StoreTable;
  now: () => Date;
  newChallengerId: () => string;
  /** A random, unguessable token. Only its hash is stored. */
  newSessionToken: () => string;
  newAttemptId: () => string;
  stepFunctions: SFNClient;
  arenaRunArn: string;
  /** LLM tokens allowed per UTC day; new attempts are refused once they are used. */
  dailyTokenBudget: number;
}

// The __Host- prefix makes browsers refuse the cookie unless it is Secure,
// host-only and set for the whole path, so no other subdomain can plant one.
export const SESSION_COOKIE = '__Host-handshake_session';
const SESSION_DAYS = 90;

const createChallengerBodySchema = z.object({ handle: z.string().max(100) });

export async function createChallengerFromRequest(
  context: ArenaApiContext,
  body: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const parsed = createChallengerBodySchema.safeParse(parseJson(body));
  if (!parsed.success) return json(400, { error: 'Send a JSON body with a handle' });
  const check = validateHandle(parsed.data.handle);
  if (!check.valid) return json(400, { error: check.reason });

  const now = context.now();
  const token = context.newSessionToken();
  try {
    const challenger = await createChallenger(context.table, {
      challengerId: context.newChallengerId(),
      handle: check.handle,
      sessionTokenHash: hashToken(token),
      createdAt: now,
      sessionExpiresAt: new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000),
    });
    return {
      ...json(201, publicChallenger(challenger)),
      cookies: [
        `${SESSION_COOKIE}=${token}; Max-Age=${SESSION_DAYS * 24 * 60 * 60}; Path=/; Secure; HttpOnly; SameSite=Lax`,
      ],
    };
  } catch (error) {
    if (error instanceof HandleTakenError) return json(409, { error: 'This handle is taken' });
    throw error;
  }
}

export type SessionLookup =
  | { found: true; challenger: Challenger }
  | { found: false; response: APIGatewayProxyStructuredResultV2 };

/** API Gateway passes cookies as `name=value` strings. */
export async function findSessionChallenger(
  context: ArenaApiContext,
  cookies: readonly string[],
): Promise<SessionLookup> {
  const token = readCookie(cookies, SESSION_COOKIE);
  if (!token) return { found: false, response: json(401, { error: 'Pick a handle first' }) };
  const challengerId = await findSessionChallengerId(
    context.table,
    hashToken(token),
    context.now(),
  );
  const challenger = challengerId ? await getChallenger(context.table, challengerId) : undefined;
  if (!challenger) {
    return {
      found: false,
      response: json(401, { error: 'Your session has ended. Pick a handle again' }),
    };
  }
  return { found: true, challenger };
}

export async function getChallengerFromSession(
  context: ArenaApiContext,
  cookies: readonly string[],
): Promise<APIGatewayProxyStructuredResultV2> {
  const session = await findSessionChallenger(context, cookies);
  return session.found ? json(200, publicChallenger(session.challenger)) : session.response;
}

function publicChallenger(challenger: Challenger) {
  const { progress } = challenger;
  return {
    id: challenger.id,
    handle: challenger.handle,
    xp: progress.xp,
    rank: rankProgress(progress.xp),
    badges: unlockedBadges(progress.stats),
    stats: progress.stats,
    currentHeldStreak: progress.currentHeldStreak,
    daily: progress.daily,
  };
}

function readCookie(cookies: readonly string[], name: string): string | undefined {
  const prefix = `${name}=`;
  return cookies.find((cookie) => cookie.startsWith(prefix))?.slice(prefix.length) || undefined;
}
