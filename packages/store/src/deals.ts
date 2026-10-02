import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { dealSchema, type Deal, type DealEvent } from '@handshake/core';
import type { StoreTable } from './table';

/** Another writer saved the deal since it was read. Read it again and retry. */
export class ConcurrentDealUpdateError extends Error {
  override name = 'ConcurrentDealUpdateError';
}

export const dealKey = (dealId: string) => ({ pk: `DEAL#${dealId}`, sk: 'META' });

// Padding keeps events in order when two share a timestamp.
const eventSortKey = (event: DealEvent) => `EVT#${event.at}#${String(event.seq).padStart(6, '0')}`;

export async function getDeal(table: StoreTable, dealId: string): Promise<Deal | undefined> {
  const { Item } = await table.client.send(
    new GetCommand({ TableName: table.name, Key: dealKey(dealId), ConsistentRead: true }),
  );
  return Item ? dealSchema.parse(Item) : undefined;
}

/**
 * Saves the deal and its new events in one transaction. The write succeeds
 * only if the stored deal still has the event count it had before these
 * events, so two writers can never both move the same deal.
 */
export async function saveDeal(table: StoreTable, deal: Deal, events: DealEvent[]): Promise<void> {
  const last = events.at(-1);
  if (!last || last.seq !== deal.eventCount || events.some((event) => event.dealId !== deal.id)) {
    throw new RangeError(`Events do not end at event ${deal.eventCount} of deal ${deal.id}`);
  }
  const previousCount = deal.eventCount - events.length;
  const writeDeal = {
    Put: {
      TableName: table.name,
      Item: { ...dealKey(deal.id), ...deal },
      ...(previousCount === 0
        ? { ConditionExpression: 'attribute_not_exists(pk)' }
        : {
            ConditionExpression: 'eventCount = :previousCount',
            ExpressionAttributeValues: { ':previousCount': previousCount },
          }),
    },
  };
  const writeEvents = events.map((event) => ({
    Put: {
      TableName: table.name,
      Item: { pk: dealKey(deal.id).pk, sk: eventSortKey(event), ...event },
    },
  }));

  try {
    await table.client.send(
      new TransactWriteCommand({ TransactItems: [writeDeal, ...writeEvents] }),
    );
  } catch (error) {
    const dealConflict =
      error instanceof TransactionCanceledException &&
      error.CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed';
    if (dealConflict) throw new ConcurrentDealUpdateError(`Deal ${deal.id} changed while saving`);
    throw error;
  }
}
