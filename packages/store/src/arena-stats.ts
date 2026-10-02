import { BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { attackCategories, type AttackCategory } from '@handshake/arena';
import { z } from 'zod';
import type { StoreTable } from './table';

export const globalStatsKey = { pk: 'STATS', sk: 'GLOBAL' };
export const dailyStatsKey = (date: string) => ({ pk: 'STATS', sk: `DAY#${date}` });
export const categoryKey = (category: AttackCategory) => ({
  pk: `CATEGORY#${category}`,
  sk: 'META',
});

const count = z.number().int().nonnegative();

export const categoryStatsSchema = z.object({
  attempts: count.default(0),
  loopholes: count.default(0),
  firstFinderId: z.string().min(1).nullable().default(null),
});

const globalStatsSchema = z.object({ attempts: count.default(0), held: count.default(0) });

export type CategoryStats = z.infer<typeof categoryStatsSchema>;

export interface ArenaStats {
  attempts: number;
  held: number;
  categories: Record<AttackCategory, CategoryStats>;
}

// BatchGet may return some keys unprocessed under load; asking again is the documented fix.
const MAX_BATCH_GET_ROUNDS = 3;

export async function getArenaStats(table: StoreTable): Promise<ArenaStats> {
  const items = await batchGetAll(table, [
    globalStatsKey,
    ...attackCategories.map((category) => categoryKey(category)),
  ]);
  const find = (key: { pk: string; sk: string }) =>
    items.find((item) => item.pk === key.pk && item.sk === key.sk) ?? {};
  const global = globalStatsSchema.parse(find(globalStatsKey));
  const categories = Object.fromEntries(
    attackCategories.map((category) => [
      category,
      categoryStatsSchema.parse(find(categoryKey(category))),
    ]),
  ) as Record<AttackCategory, CategoryStats>;
  return { ...global, categories };
}

async function batchGetAll(
  table: StoreTable,
  keys: { pk: string; sk: string }[],
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let pending: Record<string, unknown>[] = keys;
  for (let round = 0; round < MAX_BATCH_GET_ROUNDS && pending.length > 0; round++) {
    const { Responses, UnprocessedKeys } = await table.client.send(
      new BatchGetCommand({ RequestItems: { [table.name]: { Keys: pending } } }),
    );
    items.push(...(Responses?.[table.name] ?? []));
    pending = UnprocessedKeys?.[table.name]?.Keys ?? [];
  }
  if (pending.length > 0) {
    throw new Error(`DynamoDB left ${pending.length} keys unprocessed`);
  }
  return items;
}
