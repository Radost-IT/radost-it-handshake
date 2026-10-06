import { rankForXp } from '@handshake/arena';
import { getArenaStats, getLeaderboard, listChallengerAttempts } from '@handshake/store';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { attemptStatus } from './arena-attempts';
import { findSessionChallenger, type ArenaApiContext } from './arena-session';
import { json } from './http';

const LEADERBOARD_SIZE = 50;
const HISTORY_SIZE = 50;

/** The defense counter and, per category, whether anyone has found a loophole yet. */
export async function getStats(
  context: ArenaApiContext,
): Promise<APIGatewayProxyStructuredResultV2> {
  const stats = await getArenaStats(context.table);
  return json(200, {
    attempts: stats.attempts,
    held: stats.held,
    categories: Object.entries(stats.categories).map(([category, { attempts, loopholes }]) => ({
      category,
      attempts,
      loopholes,
    })),
  });
}

/** `scope=daily` shows today's daily challenge board; anything else the all-time board. */
export async function getLeaderboardPage(
  context: ArenaApiContext,
  scope: string | undefined,
): Promise<APIGatewayProxyStructuredResultV2> {
  const date = context.now().toISOString().slice(0, 10);
  const entries = await getLeaderboard(
    context.table,
    scope === 'daily' ? { kind: 'daily', date } : { kind: 'all-time' },
    LEADERBOARD_SIZE,
  );
  return json(200, {
    scope: scope === 'daily' ? 'daily' : 'all',
    date,
    entries: entries.map((entry, index) => ({
      position: index + 1,
      challengerId: entry.challengerId,
      handle: entry.handle,
      xp: entry.xp,
      rank: rankForXp(entry.xp),
    })),
  });
}

/** The session challenger's own attempts, newest first, without transcripts. */
export async function getMyAttempts(
  context: ArenaApiContext,
  authorization: string | undefined,
): Promise<APIGatewayProxyStructuredResultV2> {
  const session = await findSessionChallenger(context, authorization);
  if (!session.found) return session.response;
  const attempts = await listChallengerAttempts(context.table, session.challenger.id, HISTORY_SIZE);
  const now = context.now();
  return json(200, {
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      category: attempt.category,
      channel: attempt.channel,
      dealId: attempt.dealTemplateId,
      createdAt: attempt.createdAt,
      status: attemptStatus(attempt, now),
      outcome: attempt.result?.outcome.result ?? null,
      xpGained: attempt.result?.xpGained ?? null,
    })),
  });
}
