import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import type { StoreTable } from './table';

/** `all` counts every model call of the day; `arena` counts only arena runs. */
export type TokenPool = 'all' | 'arena';

const budgetKey = (date: string, pool: TokenPool) => ({
  pk: `BUDGET#${date}`,
  sk: pool === 'all' ? 'TOKENS' : 'ARENA',
});

const budgetItemSchema = z.object({ used: z.number().int().nonnegative() });

/**
 * Arena runs may use at most half of the day's tokens. Anyone can attack, so
 * the other half stays for Deal API deals.
 */
export function arenaTokenLimit(dailyTokenBudget: number): number {
  return Math.floor(dailyTokenBudget / 2);
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
