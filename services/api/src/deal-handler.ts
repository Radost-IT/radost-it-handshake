import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SFNClient } from '@aws-sdk/client-sfn';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { listDeals, openDeal, readDeal, submitEvidence, type DealApiContext } from './deal-api';
import { approvePurchase, decideEscalation } from './deal-approvals';
import { json, readBody } from './http';

const environment = z
  .object({
    TABLE_NAME: z.string().min(1),
    DEAL_LIFECYCLE_ARN: z.string().min(1),
    WEB_URL: z.url(),
  })
  .parse(process.env);

const context: DealApiContext = {
  table: {
    client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    name: environment.TABLE_NAME,
  },
  stepFunctions: new SFNClient({}),
  now: () => new Date().toISOString(),
  dealLifecycleArn: environment.DEAL_LIFECYCLE_ARN,
  webUrl: environment.WEB_URL,
};

export function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const credentials = { authorization: event.headers.authorization, cookies: event.cookies ?? [] };
  switch (event.routeKey) {
    case 'POST /v1/deals':
      return openDeal(context, { ...credentials, body: readBody(event) });
    case 'GET /v1/deals':
      return listDeals(context, credentials);
  }

  const dealId = event.pathParameters?.dealId;
  if (!dealId) return Promise.resolve(json(404, { error: 'Deal not found' }));
  const request = { ...credentials, dealId, body: readBody(event) };
  switch (event.routeKey) {
    case 'GET /v1/deals/{dealId}':
      return readDeal(context, request);
    case 'POST /v1/deals/{dealId}/evidence':
      return submitEvidence(context, request);
    case 'POST /v1/deals/{dealId}/purchase-approval':
      return approvePurchase(context, request);
    case 'POST /v1/deals/{dealId}/human-decision':
      return decideEscalation(context, request);
    default:
      return Promise.resolve(json(404, { error: 'Route not found' }));
  }
}
