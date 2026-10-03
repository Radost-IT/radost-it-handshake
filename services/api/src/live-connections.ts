import {
  closeLiveConnection,
  liveTopicSchema,
  MAX_TOPICS_PER_CONNECTION,
  openLiveConnection,
  type StoreTable,
} from '@handshake/store';
import { z } from 'zod';

export interface LiveContext {
  table: StoreTable;
  now: () => Date;
}

// API Gateway closes every WebSocket after two hours.
const CONNECTION_LIFETIME_MS = 2 * 60 * 60 * 1000;

const connectEventSchema = z.object({
  requestContext: z.object({ routeKey: z.literal('$connect'), connectionId: z.string().min(1) }),
  queryStringParameters: z.object({ topics: z.string() }).optional(),
});

const disconnectEventSchema = z.object({
  requestContext: z.object({ routeKey: z.literal('$disconnect'), connectionId: z.string().min(1) }),
});

const topicsSchema = z
  .string()
  .transform((topics) => [...new Set(topics.split(','))])
  .pipe(z.array(liveTopicSchema).min(1).max(MAX_TOPICS_PER_CONNECTION));

/**
 * Handles the WebSocket routes. The browser names the topics it wants in the
 * connect URL (`?topics=arena,attempt:<id>`) and only listens afterwards.
 * Every event is public arena data, so connecting needs no session.
 */
export async function handleLiveEvent(
  context: LiveContext,
  event: unknown,
): Promise<{ statusCode: number }> {
  const connect = connectEventSchema.safeParse(event);
  if (connect.success) {
    const topics = topicsSchema.safeParse(connect.data.queryStringParameters?.topics);
    if (!topics.success) return { statusCode: 400 };
    await openLiveConnection(context.table, {
      connectionId: connect.data.requestContext.connectionId,
      topics: topics.data,
      expiresAt: new Date(context.now().getTime() + CONNECTION_LIFETIME_MS),
    });
    return { statusCode: 200 };
  }
  const disconnect = disconnectEventSchema.parse(event);
  await closeLiveConnection(context.table, disconnect.requestContext.connectionId);
  return { statusCode: 200 };
}
