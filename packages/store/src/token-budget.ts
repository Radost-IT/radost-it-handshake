import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import type { StoreTable } from './table';

/**
 * `all` counts every model call of the day, `arena` only arena runs, and an
 * owner pool the calls of one developer's deals or one challenger's attempts.
 */
export type TokenPool = 'all' | 'arena' | `developer:${string}` | `challenger:${string}`;

export const developerTokenPool = (developerId: string): TokenPool => `developer:${developerId}`;
export const challengerTokenPool = (challengerId: string): TokenPool =>
  `challenger:${challengerId}`;

function budgetSortKey(pool: TokenPool): string {
  if (pool === 'all') return 'TOKENS';
  if (pool === 'arena') return 'ARENA';
  return `POOL#${pool}`;
}

const budgetKey = (date: string, pool: TokenPool) => ({
  pk: `BUDGET#${date}`,
  sk: budgetSortKey(pool),
});

const budgetItemSchema = z.object({ used: z.number().int().nonnegative() });

/**
 * Arena runs may use at most half of the day's tokens. Anyone can attack, so
 * the other half stays for Deal API deals.
 */
export function arenaTokenLimit(dailyTokenBudget: number): number {
  return Math.floor(dailyTokenBudget / 2);
}

/**
 * One developer or challenger may use at most a fifth of the day's tokens, so
 * a single account cannot use up the day for everyone else.
 */
export function ownerTokenLimit(dailyTokenBudget: number): number {
  return Math.floor(dailyTokenBudget / 5);
}

/** LLM tokens, input and output together, used on a UTC day. */
export async function getTokensUsed(
  table: StoreTable,
  date: string,
  pool: TokenPool,
): Promise<number> {
  const { Item } = await table.client.send(
    new GetCommand({ TableName: table.name, Key: budgetKey(date, pool), ConsistentRead: true }),
  );
  return Item ? budgetItemSchema.parse(Item).used : 0;
}

export async function addTokensUsed(
  table: StoreTable,
  date: string,
  pool: TokenPool,
  tokens: number,
): Promise<void> {
  await table.client.send(
    new UpdateCommand({
      TableName: table.name,
      Key: budgetKey(date, pool),
      UpdateExpression: 'ADD used :tokens',
      ExpressionAttributeValues: { ':tokens': tokens },
    }),
  );
}
