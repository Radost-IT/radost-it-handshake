import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { attackCategories } from '@handshake/arena';
import { z } from 'zod';
import type { StoreTable } from './table';

export const challengerKey = (challengerId: string) => ({
  pk: `CHALLENGER#${challengerId}`,
  sk: 'META',
});

const count = z.number().int().nonnegative();

export const challengerProgressSchema = z.object({
  xp: count,
  stats: z.object({
    loopholes: count,
    firstLoopholeCategories: count,
    categoriesTried: z.array(z.enum(attackCategories)).readonly(),
    textLoopholes: count,
    evidenceLoopholes: count,
    longestHeldStreak: count,
    regressionsHolding: count,
    dailyChallengeDays: count,
  }),
  currentHeldStreak: count,
  daily: z.object({ date: z.iso.date(), xp: count }).nullable(),
});

export const challengerSchema = z.object({
  id: z.string().min(1),
  handle: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  /** Grows by one with every recorded attempt, so concurrent writers cannot both win. */
  version: count,
  progress: challengerProgressSchema,
});

export type Challenger = z.infer<typeof challengerSchema>;

export async function getChallenger(
  table: StoreTable,
  challengerId: string,
): Promise<Challenger | undefined> {
  const { Item } = await table.client.send(
    new GetCommand({ TableName: table.name, Key: challengerKey(challengerId) }),
  );
  return Item ? challengerSchema.parse(Item) : undefined;
}
