import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SFNClient } from '@aws-sdk/client-sfn';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { approvePurchase, decideEscalation, type DealApiContext } from './deal-approvals';
import { json, readBody } from './http';

const environment = z.object({ TABLE_NAME: z.string().min(1) }).parse(process.env);

const context: DealApiContext = {
  table: {
    client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    name: environment.TABLE_NAME,
  },
  stepFunctions: new SFNClient({}),
  now: () => new Date().toISOString(),
};

export function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const dealId = event.pathParameters?.dealId;
  if (!dealId) return Promise.resolve(json(404, { error: 'Deal not found' }));
  const request = { dealId, authorization: event.headers.authorization, body: readBody(event) };
  switch (event.routeKey) {
    case 'POST /deals/{dealId}/purchase-approval':
      return approvePurchase(context, request);
    case 'POST /deals/{dealId}/human-decision':
      return decideEscalation(context, request);
    default:
      return Promise.resolve({ statusCode: 404 });
  }
}
