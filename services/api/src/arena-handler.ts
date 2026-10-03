import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SFNClient } from '@aws-sdk/client-sfn';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { loadDailyTokenBudget } from '@handshake/config';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getAttempt, listArenaDeals, submitAttempt } from './arena-attempts';
import {
  createChallengerFromRequest,
  getChallengerFromSession,
  type ArenaApiContext,
} from './arena-challengers';
import { readBody } from './http';

const environment = z
  .object({ TABLE_NAME: z.string().min(1), ARENA_RUN_ARN: z.string().min(1) })
  .parse(process.env);

const context: ArenaApiContext = {
  table: {
    client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    name: environment.TABLE_NAME,
  },
  now: () => new Date(),
  newChallengerId: () => randomUUID(),
  newSessionToken: () => randomBytes(32).toString('base64url'),
  newAttemptId: () => randomUUID(),
  stepFunctions: new SFNClient({}),
  arenaRunArn: environment.ARENA_RUN_ARN,
  dailyTokenBudget: await loadDailyTokenBudget(),
};

export function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  switch (event.routeKey) {
    case 'POST /arena/challengers':
      return createChallengerFromRequest(context, readBody(event));
    case 'GET /arena/challengers/me':
      return getChallengerFromSession(context, event.cookies ?? []);
    case 'POST /arena/attempts':
      return submitAttempt(context, {
        body: readBody(event),
        cookies: event.cookies ?? [],
        sourceIp: event.requestContext.http.sourceIp,
      });
    case 'GET /arena/deals':
      return Promise.resolve(listArenaDeals(context));
    case 'GET /arena/attempts/{attemptId}':
      return getAttempt(context, event.pathParameters?.attemptId);
    default:
      return Promise.resolve({ statusCode: 404 });
  }
}
