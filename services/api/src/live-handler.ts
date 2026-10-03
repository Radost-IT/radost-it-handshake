import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { handleLiveEvent, type LiveContext } from './live-connections';

const environment = z.object({ TABLE_NAME: z.string().min(1) }).parse(process.env);

const context: LiveContext = {
  table: {
    client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    name: environment.TABLE_NAME,
  },
  now: () => new Date(),
};

export function handler(event: unknown): Promise<{ statusCode: number }> {
  return handleLiveEvent(context, event);
}
