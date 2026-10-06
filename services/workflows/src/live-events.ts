import {
  type ApiGatewayManagementApiClient,
  GoneException,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import type { BadgeId, Rank } from '@handshake/arena';
import { closeLiveConnection, listLiveConnections, type StoreTable } from '@handshake/store';

/** What the browser hears over the WebSocket. Each event says what changed, not every field. */
export type LiveEvent =
  | { type: 'arena.result'; attemptId: string; status: 'judged' | 'failed' }
  | {
      type: 'challenger.progress';
      challengerId: string;
      xp: number;
      xpGained: number;
      rank: Rank;
      rankUp: boolean;
      newBadges: BadgeId[];
    }
  | { type: 'arena.stats'; attempts: number; held: number }
  | { type: 'deal.updated'; dealId: string };

export type PublishLiveEvent = (topic: string, event: LiveEvent) => Promise<void>;

export interface LivePublisher {
  table: StoreTable;
  /** Points at the WebSocket stage's callback URL. */
  connections: ApiGatewayManagementApiClient;
  now: () => Date;
}

/** Sends the event to every open connection on the topic and forgets the ones that closed. */
export async function publishLiveEvent(
  publisher: LivePublisher,
  topic: string,
  event: LiveEvent,
): Promise<void> {
  const connectionIds = await listLiveConnections(publisher.table, topic, publisher.now());
  const data = JSON.stringify(event);
  await Promise.all(
    connectionIds.map(async (connectionId) => {
      try {
        await publisher.connections.send(
          new PostToConnectionCommand({ ConnectionId: connectionId, Data: data }),
        );
      } catch (error) {
        // A browser that left without a clean close shows up here first.
        if (error instanceof GoneException) {
          await closeLiveConnection(publisher.table, connectionId);
          return;
        }
        throw error;
      }
    }),
  );
}
