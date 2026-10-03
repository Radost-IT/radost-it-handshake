import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  createChallengerFromRequest,
  getChallengerFromSession,
  type ArenaApiContext,
} from './arena-challengers';
import { readBody } from './http';

const environment = z.object({ TABLE_NAME: z.string().min(1) }).parse(process.env);

const context: ArenaApiContext = {
  table: {
    client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    name: environment.TABLE_NAME,
  },
  now: () => new Date(),
  newChallengerId: () => randomUUID(),
  newSessionToken: () => randomBytes(32).toString('base64url'),
};

export function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  switch (event.routeKey) {
    case 'POST /arena/challengers':
      return createChallengerFromRequest(context, readBody(event));
    case 'GET /arena/challengers/me':
      return getChallengerFromSession(context, event.cookies ?? []);
    default:
      return Promise.resolve({ statusCode: 404 });
  }
}
