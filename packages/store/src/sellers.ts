import { setTimeout as sleep } from 'node:timers/promises';
import {
  BatchWriteCommand,
  QueryCommand,
  type BatchWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { compareMoney, hasSameCurrency, moneySchema } from '@handshake/core';
import { z } from 'zod';
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

// DynamoDB accepts at most 25 writes per batch.
const BATCH_SIZE = 25;
const MAX_BATCH_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 100;

type WriteRequests = NonNullable<BatchWriteCommandInput['RequestItems']>[string];

// GSI1 lists every seeded seller under one partition, so the arena can pick one without a scan.
const SELLERS = 'SELLERS';

export class UnprocessedSellersError extends Error {
  override name = 'UnprocessedSellersError';
}

/** Saving a seller again replaces it, so seeding twice gives the same table. */
export async function saveSellers(table: StoreTable, sellers: Seller[]): Promise<void> {
  const batches: Seller[][] = [];
  for (let start = 0; start < sellers.length; start += BATCH_SIZE) {
    batches.push(sellers.slice(start, start + BATCH_SIZE));
  }
  await Promise.all(batches.map((batch) => writeBatch(table, batch)));
}

async function writeBatch(table: StoreTable, sellers: Seller[]): Promise<void> {
  let requests: WriteRequests = sellers.map((seller) => ({
    PutRequest: {
      Item: {
        pk: `SELLER#${seller.sellerId}`,
        sk: 'META',
        gsi1pk: SELLERS,
        gsi1sk: seller.sellerId,
        ...seller,
      },
    },
  }));
  for (let attempt = 1; ; attempt++) {
    const result = await table.client.send(
      new BatchWriteCommand({ RequestItems: { [table.name]: requests } }),
    );
    requests = result.UnprocessedItems?.[table.name] ?? [];
    if (requests.length === 0) return;
    if (attempt === MAX_BATCH_ATTEMPTS) break;
    // DynamoDB returns unprocessed items when throttled, so back off before retrying.
    await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
  }
  throw new UnprocessedSellersError(
    `DynamoDB left ${String(requests.length)} sellers unwritten after ${String(MAX_BATCH_ATTEMPTS)} attempts`,
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
