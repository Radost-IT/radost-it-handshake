import {
  ApiGatewayManagementApiClient,
  GoneException,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { publishLiveEvent } from './live-events';

const dynamodb = mockClient(DynamoDBDocumentClient);
const connections = mockClient(ApiGatewayManagementApiClient);
const now = new Date('2026-10-03T12:00:00Z');
const publisher = {
  table: { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' },
  connections: new ApiGatewayManagementApiClient({ endpoint: 'https://example.com' }),
  now: () => now,
};
const event = { type: 'arena.stats', attempts: 12, held: 11 } as const;
const openUntil = now.getTime() / 1000 + 600;

beforeEach(() => {
  dynamodb.reset();
  connections.reset();
});

describe('publishLiveEvent', () => {
  it('sends the event as JSON to every connection on the topic', async () => {
    dynamodb.on(QueryCommand).resolves({
      Items: [
        { connectionId: 'c1', ttl: openUntil },
        { connectionId: 'c2', ttl: openUntil },
      ],
    });
    connections.on(PostToConnectionCommand).resolves({});

    await publishLiveEvent(publisher, 'arena', event);

    expect(
      connections.commandCalls(PostToConnectionCommand).map((call) => call.args[0].input),
    ).toEqual([
      { ConnectionId: 'c1', Data: JSON.stringify(event) },
      { ConnectionId: 'c2', Data: JSON.stringify(event) },
    ]);
  });

  it('removes a connection that has gone away', async () => {
    dynamodb.on(QueryCommand).resolves({ Items: [{ connectionId: 'c1', ttl: openUntil }] });
    dynamodb.on(GetCommand).resolves({ Item: { topics: ['arena'] } });
    dynamodb.on(TransactWriteCommand).resolves({});
    connections
      .on(PostToConnectionCommand)
      .rejects(new GoneException({ message: 'Gone', $metadata: {} }));

    await publishLiveEvent(publisher, 'arena', event);

    expect(dynamodb.commandCalls(TransactWriteCommand)).toHaveLength(1);
  });

  it('fails on any other error so the step can retry', async () => {
    dynamodb.on(QueryCommand).resolves({ Items: [{ connectionId: 'c1', ttl: openUntil }] });
    connections.on(PostToConnectionCommand).rejects(new Error('Throttled'));

    await expect(publishLiveEvent(publisher, 'arena', event)).rejects.toThrow('Throttled');
  });
});
