import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/** The single DynamoDB table and the client that talks to it. */
export interface StoreTable {
  client: DynamoDBDocumentClient;
  name: string;
}
