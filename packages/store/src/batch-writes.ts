import { setTimeout as sleep } from 'node:timers/promises';
import { BatchWriteCommand, type BatchWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import type { StoreTable } from './table';

export type WriteRequest = NonNullable<BatchWriteCommandInput['RequestItems']>[string][number];

// DynamoDB accepts at most 25 writes per batch.
const BATCH_SIZE = 25;
const MAX_BATCH_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 100;

export class UnprocessedWritesError extends Error {
  override name = 'UnprocessedWritesError';
}

/** Sends puts and deletes in batches of 25, retrying the items DynamoDB leaves unprocessed. */
export async function writeInBatches(table: StoreTable, requests: WriteRequest[]): Promise<void> {
  const batches: WriteRequest[][] = [];
  for (let start = 0; start < requests.length; start += BATCH_SIZE) {
    batches.push(requests.slice(start, start + BATCH_SIZE));
  }
  await Promise.all(batches.map((batch) => writeBatch(table, batch)));
}

async function writeBatch(table: StoreTable, batch: WriteRequest[]): Promise<void> {
  let requests = batch;
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
  throw new UnprocessedWritesError(
    `DynamoDB left ${String(requests.length)} items unwritten after ${String(MAX_BATCH_ATTEMPTS)} attempts`,
  );
}
