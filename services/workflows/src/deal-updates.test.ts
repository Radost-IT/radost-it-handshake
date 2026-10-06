import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { announceDealUpdates } from './deal-updates';

const dynamodb = mockClient(DynamoDBDocumentClient);
const connections = mockClient(ApiGatewayManagementApiClient);
const now = new Date('2026-10-06T12:00:00Z');
const publisher = {
  table: { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' },
  connections: new ApiGatewayManagementApiClient({ endpoint: 'https://example.com' }),
  now: () => now,
};
const dealId = '0b7e1d8a-4c3f-4a7e-9f21-6d5c8b3a2e10';
const changed = (pk: string, sk: string) => ({
  dynamodb: { Keys: { pk: { S: pk }, sk: { S: sk } } },
});

beforeEach(() => {
  dynamodb.reset();
  connections.reset();
});

describe('announceDealUpdates', () => {
  it('sends one update per deal to the pages showing it', async () => {
    dynamodb.on(QueryCommand).resolves({
      Items: [{ connectionId: 'c1', ttl: now.getTime() / 1000 + 600 }],
    });
    connections.on(PostToConnectionCommand).resolves({});

    await announceDealUpdates(publisher, {
      Records: [changed(`DEAL#${dealId}`, 'NEGOTIATION'), changed(`DEAL#${dealId}`, 'META')],
    });

    expect(dynamodb.commandCalls(QueryCommand)[0]?.args[0].input.ExpressionAttributeValues).toEqual(
      {
        ':pk': `TOPIC#deal:${dealId}`,
      },
    );
    expect(
      connections.commandCalls(PostToConnectionCommand).map((call) => call.args[0].input),
    ).toEqual([{ ConnectionId: 'c1', Data: JSON.stringify({ type: 'deal.updated', dealId }) }]);
  });

  it('ignores items outside a deal partition', async () => {
    await announceDealUpdates(publisher, { Records: [changed('SELLER#s1', 'META')] });

    expect(dynamodb.commandCalls(QueryCommand)).toHaveLength(0);
  });
});
