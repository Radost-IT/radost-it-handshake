import { dealTopic } from '@handshake/store';
import { z } from 'zod';
import { publishLiveEvent, type LivePublisher } from './live-events';

const DEAL_PARTITION_PREFIX = 'DEAL#';

const dealStreamSchema = z.object({
  Records: z.array(
    z.object({ dynamodb: z.object({ Keys: z.object({ pk: z.object({ S: z.string() }) }) }) }),
  ),
});

/**
 * Tells the pages showing a deal that it changed, so they refetch it at once
 * instead of waiting for the next poll. The stream filter passes only the deal
 * and its negotiation, and a batch can hold several changes to the same deal.
 */
export async function announceDealUpdates(publisher: LivePublisher, event: unknown): Promise<void> {
  const { Records } = dealStreamSchema.parse(event);
  const dealIds = new Set(
    Records.map((record) => record.dynamodb.Keys.pk.S)
      .filter((pk) => pk.startsWith(DEAL_PARTITION_PREFIX))
      .map((pk) => pk.slice(DEAL_PARTITION_PREFIX.length)),
  );
  await Promise.all(
    [...dealIds].map((dealId) =>
      publishLiveEvent(publisher, dealTopic(dealId), { type: 'deal.updated', dealId }),
    ),
  );
}
