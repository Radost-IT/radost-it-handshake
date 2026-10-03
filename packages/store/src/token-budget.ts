import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import type { StoreTable } from './table';

const budgetKey = (date: string) => ({ pk: `BUDGET#${date}`, sk: 'TOKENS' });

const budgetItemSchema = z.object({ used: z.number().int().nonnegative() });

/** LLM tokens, input and output together, used on a UTC day. */
export async function getTokensUsed(table: StoreTable, date: string): Promise<number> {
  const { Item } = await table.client.send(
    new GetCommand({ TableName: table.name, Key: budgetKey(date), ConsistentRead: true }),
  );
  return Item ? budgetItemSchema.parse(Item).used : 0;
}

export async function addTokensUsed(
  table: StoreTable,
  date: string,
  tokens: number,
): Promise<void> {
  await table.client.send(
    new UpdateCommand({
      TableName: table.name,
      Key: budgetKey(date),
      UpdateExpression: 'ADD used :tokens',
      ExpressionAttributeValues: { ':tokens': tokens },
    }),
  );
}
