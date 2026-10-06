import { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { announceDealUpdates } from './deal-updates';
import type { LivePublisher } from './live-events';

const environment = z
  .object({ TABLE_NAME: z.string().min(1), LIVE_CALLBACK_URL: z.url() })
  .parse(process.env);

const publisher: LivePublisher = {
  table: {
    client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    name: environment.TABLE_NAME,
  },
  connections: new ApiGatewayManagementApiClient({ endpoint: environment.LIVE_CALLBACK_URL }),
  now: () => new Date(),
};

/** Receives changed deal keys from the table's DynamoDB stream. */
export async function handler(event: unknown): Promise<void> {
  await announceDealUpdates(publisher, event);
}
