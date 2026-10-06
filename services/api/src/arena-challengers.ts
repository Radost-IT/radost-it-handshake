import { rankProgress, unlockedBadges, validateHandle } from '@handshake/arena';
import {
  ChallengerNotAllowedError,
  createChallenger,
  HandleTakenError,
  type Challenger,
} from '@handshake/store';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { json, parseJson } from './http';
import { findSessionAccount, type ArenaApiContext } from './arena-session';

const createChallengerBodySchema = z.object({ handle: z.string().max(100) });

/** Lets a signed-in, approved account pick its handle. */
export async function createChallengerFromRequest(
  context: ArenaApiContext,
  request: { body: string; authorization: string | undefined },
): Promise<APIGatewayProxyStructuredResultV2> {
  const session = await findSessionAccount(context, request.authorization);
  if (!session.found) return session.response;
  const parsed = createChallengerBodySchema.safeParse(parseJson(request.body));
  if (!parsed.success) return json(400, { error: 'Send a JSON body with a handle' });
  const check = validateHandle(parsed.data.handle);
  if (!check.valid) return json(400, { error: check.reason });

  try {
    const challenger = await createChallenger(context.table, {
      challengerId: context.newChallengerId(),
      accountId: session.account.id,
      handle: check.handle,
      createdAt: context.now(),
    });
    return json(201, publicChallenger(challenger));
  } catch (error) {
    if (error instanceof HandleTakenError) return json(409, { error: 'This handle is taken' });
    if (error instanceof ChallengerNotAllowedError) {
      return json(403, { error: 'Your account cannot pick a handle. Is it approved?' });
    }
    throw error;
  }
}

export function publicChallenger(challenger: Challenger) {
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
