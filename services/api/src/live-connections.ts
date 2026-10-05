import {
  closeLiveConnection,
  liveTopicSchema,
  MAX_TOPICS_PER_CONNECTION,
  openLiveConnection,
  takeRateLimitSlot,
  type StoreTable,
} from '@handshake/store';
import { z } from 'zod';
import { hashToken } from './http';

export interface LiveContext {
  table: StoreTable;
  now: () => Date;
}

// API Gateway closes every WebSocket after two hours.
const CONNECTION_LIFETIME_MS = 2 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
// A page reconnects after each drop, so a visitor needs a few, never hundreds.
const CONNECTS_PER_IP_PER_HOUR = 120;

const connectEventSchema = z.object({
  requestContext: z.object({
    routeKey: z.literal('$connect'),
    connectionId: z.string().min(1),
    identity: z.object({ sourceIp: z.string().min(1) }),
  }),
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
    const { connectionId, identity } = connect.data.requestContext;
    const now = context.now();
    // Each connection writes a few items, so one network must not open them without end.
    const allowed = await takeRateLimitSlot(context.table, {
      subject: `live-connect-ip#${hashToken(identity.sourceIp)}`,
      window: now.toISOString().slice(0, 13),
      limit: CONNECTS_PER_IP_PER_HOUR,
      expiresAt: new Date(now.getTime() + 2 * HOUR_MS),
    });
    if (!allowed) return { statusCode: 429 };
    await openLiveConnection(context.table, {
      connectionId,
      topics: topics.data,
      expiresAt: new Date(now.getTime() + CONNECTION_LIFETIME_MS),
    });
    return { statusCode: 200 };
  }
  const disconnect = disconnectEventSchema.parse(event);
  await closeLiveConnection(context.table, disconnect.requestContext.connectionId);
  return { statusCode: 200 };
}
