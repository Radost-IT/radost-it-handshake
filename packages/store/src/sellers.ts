import { BatchGetCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { compareMoney, hasSameCurrency, moneySchema } from '@handshake/core';
import { z } from 'zod';
import { writeInBatches } from './batch-writes';
import type { StoreTable } from './table';

export const sellerSchema = z
  .object({
    sellerId: z.string().min(1),
    name: z.string().min(1).max(80),
    persona: z.string().min(1).max(600),
    floorPrice: moneySchema,
    listing: z.object({
      productId: z.string().min(1),
      title: z.string().min(1),
      description: z.string(),
      categoryPath: z.array(z.string().min(1)),
      listPrice: moneySchema,
    }),
  })
  .refine(
    ({ floorPrice, listing }) =>
      hasSameCurrency(floorPrice, listing.listPrice) &&
      compareMoney(floorPrice, listing.listPrice) <= 0,
    { message: 'The floor price must be in the listing currency and not above the list price' },
  );

export type Seller = z.infer<typeof sellerSchema>;

const sellerKey = (sellerId: string) => ({ pk: `SELLER#${sellerId}`, sk: 'META' });

// GSI1 lists every seeded seller under one partition, so the arena can pick one without a scan.
const SELLERS = 'SELLERS';

/** Saving a seller again replaces it, so seeding twice gives the same table. */
export async function saveSellers(table: StoreTable, sellers: Seller[]): Promise<void> {
  await writeInBatches(
    table,
    sellers.map((seller) => ({
      PutRequest: {
        Item: {
          ...sellerKey(seller.sellerId),
          gsi1pk: SELLERS,
          gsi1sk: seller.sellerId,
          ...seller,
        },
      },
    })),
  );
}

/** Up to `limit` seeded sellers, ordered by seller ID. */
export async function listSellers(table: StoreTable, limit: number): Promise<Seller[]> {
  const { Items = [] } = await table.client.send(
    new QueryCommand({
      TableName: table.name,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': SELLERS },
      Limit: limit,
    }),
  );
  return Items.map((item) => sellerSchema.parse(item));
}

export async function getSeller(table: StoreTable, sellerId: string): Promise<Seller | undefined> {
  const { Item } = await table.client.send(
    new GetCommand({ TableName: table.name, Key: sellerKey(sellerId) }),
  );
  return Item ? sellerSchema.parse(Item) : undefined;
}

export class UnreadSellersError extends Error {
  override name = 'UnreadSellersError';
}

/** The sellers with these IDs, in the same order. IDs without a seller are left out. */
export async function getSellers(table: StoreTable, sellerIds: string[]): Promise<Seller[]> {
  if (sellerIds.length === 0) return [];
  const { Responses = {}, UnprocessedKeys = {} } = await table.client.send(
    new BatchGetCommand({
      RequestItems: { [table.name]: { Keys: sellerIds.map((sellerId) => sellerKey(sellerId)) } },
    }),
  );
  if (Object.keys(UnprocessedKeys).length > 0) {
    throw new UnreadSellersError('DynamoDB did not return every seller; try again');
  }
  const sellers = new Map(
    (Responses[table.name] ?? []).map((item) => {
      const seller = sellerSchema.parse(item);
      return [seller.sellerId, seller];
    }),
  );
  return sellerIds.flatMap((sellerId) => sellers.get(sellerId) ?? []);
}
