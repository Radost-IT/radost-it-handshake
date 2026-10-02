import { DeleteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { dealKey } from './deals';
import type { StoreTable } from './table';

/** What a paused deal lifecycle waits for before it continues. */
export type WaitSignal = 'checkout' | 'evidence' | 'verdict' | 'human-decision' | 'capture';

// Step Functions keeps a task token valid for at most a year, but no wait in
// the lifecycle outlasts the 29-day authorization, so a month is enough.
const WAIT_TTL_SECONDS = 30 * 24 * 60 * 60;

const waitKey = (dealId: string, signal: WaitSignal) => ({
  pk: dealKey(dealId).pk,
  sk: `WAIT#${signal}`,
});

/**
 * Stores the Step Functions task token of a paused lifecycle. A newer wait for
 * the same signal replaces the older one, whose token has timed out by then.
 */
export async function saveWait(
  table: StoreTable,
  dealId: string,
  signal: WaitSignal,
  taskToken: string,
  now: Date,
): Promise<void> {
  await table.client.send(
    new PutCommand({
      TableName: table.name,
      Item: {
        ...waitKey(dealId, signal),
        taskToken,
        ttl: Math.floor(now.getTime() / 1000) + WAIT_TTL_SECONDS,
      },
    }),
  );
}

const storedWaitSchema = z.object({ taskToken: z.string().min(1) });

/**
 * Removes and returns the task token for a signal, so only one caller can
 * resume the lifecycle. Returns undefined when nothing is waiting.
 */
export async function takeWait(
  table: StoreTable,
  dealId: string,
  signal: WaitSignal,
): Promise<string | undefined> {
  const { Attributes } = await table.client.send(
    new DeleteCommand({
      TableName: table.name,
      Key: waitKey(dealId, signal),
      ReturnValues: 'ALL_OLD',
    }),
  );
  return Attributes ? storedWaitSchema.parse(Attributes).taskToken : undefined;
}
