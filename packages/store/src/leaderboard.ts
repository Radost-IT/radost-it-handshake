import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import type { StoreTable } from './table';

/** The all-time board, or the board of one daily challenge date. */
export type LeaderboardScope = { kind: 'all-time' } | { kind: 'daily'; date: string };

export const leaderboardPartition = (scope: LeaderboardScope) =>
  scope.kind === 'all-time' ? 'LEADERBOARD' : `DAILY#${scope.date}`;

// Zero padding makes the string order of sort keys match the order of scores.
export const leaderboardKey = (scope: LeaderboardScope, xp: number, challengerId: string) => ({
  pk: leaderboardPartition(scope),
  sk: `SCORE#${String(xp).padStart(10, '0')}#${challengerId}`,
});

const leaderboardEntrySchema = z.object({
  challengerId: z.string().min(1),
  handle: z.string().min(1),
  xp: z.number().int().nonnegative(),
});

export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

/** The highest scores first. */
export async function getLeaderboard(
  table: StoreTable,
  scope: LeaderboardScope,
  limit: number,
): Promise<LeaderboardEntry[]> {
  const { Items = [] } = await table.client.send(
    new QueryCommand({
      TableName: table.name,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': leaderboardPartition(scope) },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return Items.map((item) => leaderboardEntrySchema.parse(item));
}
