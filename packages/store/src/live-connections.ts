import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import type { StoreTable } from './table';

/** Everyone watching the arena: the defense counter. */
export const ARENA_TOPIC = 'arena';

/** The person waiting for one attempt's result. */
export const attemptTopic = (attemptId: string) => `attempt:${attemptId}`;

/** The pages showing one deal. Events on it carry only the deal ID, so the topic exposes nothing else. */
export const dealTopic = (dealId: string) => `deal:${dealId}`;

export const liveTopicSchema = z.union([
  z.literal(ARENA_TOPIC),
  z.string().regex(/^attempt:[0-9a-f-]{36}$/),
  z.string().regex(/^deal:[0-9a-f-]{36}$/),
]);

// One connection writes its topics in one transaction, which caps the item count.
export const MAX_TOPICS_PER_CONNECTION = 4;

const connectionKey = (connectionId: string) => ({ pk: `LIVE#${connectionId}`, sk: 'META' });
const subscriptionKey = (topic: string, connectionId: string) => ({
  pk: `TOPIC#${topic}`,
  sk: `LIVE#${connectionId}`,
});

const epochSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

export interface LiveConnection {
  connectionId: string;
  topics: string[];
  /** API Gateway closes a WebSocket after two hours, so nothing outlives that. */
  expiresAt: Date;
}

export async function openLiveConnection(
  table: StoreTable,
  connection: LiveConnection,
): Promise<void> {
  const ttl = epochSeconds(connection.expiresAt);
  const { connectionId, topics } = connection;
  await table.client.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: table.name,
            Item: { ...connectionKey(connectionId), topics, ttl },
          },
        },
        ...topics.map((topic) => ({
          Put: {
            TableName: table.name,
            Item: { ...subscriptionKey(topic, connectionId), connectionId, ttl },
          },
        })),
      ],
    }),
  );
}

const connectionSchema = z.object({ topics: z.array(z.string()) });

/** Removes a closed connection and its subscriptions. Closing it twice is harmless. */
export async function closeLiveConnection(table: StoreTable, connectionId: string): Promise<void> {
  const { Item } = await table.client.send(
    new GetCommand({ TableName: table.name, Key: connectionKey(connectionId) }),
  );
  if (!Item) return;
  const { topics } = connectionSchema.parse(Item);
  await table.client.send(
    new TransactWriteCommand({
      TransactItems: [
        connectionKey(connectionId),
        ...topics.map((topic) => subscriptionKey(topic, connectionId)),
      ].map((Key) => ({ Delete: { TableName: table.name, Key } })),
    }),
  );
}

const subscriptionSchema = z.object({ connectionId: z.string().min(1), ttl: z.number().int() });

/** The open connections subscribed to a topic. */
export async function listLiveConnections(
  table: StoreTable,
  topic: string,
  now: Date,
): Promise<string[]> {
  const connectionIds: string[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await table.client.send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': `TOPIC#${topic}` },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) {
      const subscription = subscriptionSchema.parse(item);
      // DynamoDB deletes expired items only eventually, so expiry is checked here too.
      if (subscription.ttl > epochSeconds(now)) connectionIds.push(subscription.connectionId);
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return connectionIds;
}
