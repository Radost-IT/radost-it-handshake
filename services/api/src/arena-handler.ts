import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SFNClient } from '@aws-sdk/client-sfn';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { loadArenaMailConfig, loadDailyTokenBudget } from '@handshake/config';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getAttempt, listArenaDeals, submitAttempt } from './arena-attempts';
import { getAccountFromSession, requestAccessFromSession } from './arena-access';
import { createChallengerFromRequest } from './arena-challengers';
import { getLeaderboardPage, getMyAttempts, getStats } from './arena-reads';
import type { ArenaApiContext } from './arena-session';
import { refreshSession, requestSignInCode, signOut, verifySignInCode } from './arena-sign-in';
import { readBody } from './http';
import { applyAsMerchant, getMerchantSettings } from './merchants';

const environment = z
  .object({ TABLE_NAME: z.string().min(1), ARENA_RUN_ARN: z.string().min(1) })
  .parse(process.env);

const [dailyTokenBudget, mail] = await Promise.all([loadDailyTokenBudget(), loadArenaMailConfig()]);

const context: ArenaApiContext = {
  table: {
    client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    name: environment.TABLE_NAME,
  },
  now: () => new Date(),
  newChallengerId: () => randomUUID(),
  newSessionToken: () => randomBytes(32).toString('base64url'),
  newSessionId: () => randomUUID(),
  newSignInCode: () => randomInt(0, 1_000_000).toString().padStart(6, '0'),
  newAttemptId: () => randomUUID(),
  stepFunctions: new SFNClient({}),
  arenaRunArn: environment.ARENA_RUN_ARN,
  dailyTokenBudget,
  mail,
};

export function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  switch (event.routeKey) {
    case 'POST /arena/sign-in':
      return requestSignInCode(context, {
        body: readBody(event),
        sourceIp: event.requestContext.http.sourceIp,
      });
    case 'POST /arena/sign-in/verify':
      return verifySignInCode(context, {
        body: readBody(event),
        sourceIp: event.requestContext.http.sourceIp,
      });
    case 'POST /arena/session/refresh':
      return refreshSession(context, readBody(event));
    case 'POST /arena/sign-out':
      return signOut(context, readBody(event));
    case 'GET /arena/account':
      return getAccountFromSession(context, event.headers.authorization);
    case 'GET /arena/merchant':
      return getMerchantSettings(context, event.headers.authorization);
    case 'POST /arena/merchant-applications':
      return applyAsMerchant(context, {
        body: readBody(event),
        authorization: event.headers.authorization,
      });
    case 'POST /arena/access-requests':
      return requestAccessFromSession(context, {
        body: readBody(event),
        authorization: event.headers.authorization,
      });
    case 'POST /arena/challengers':
      return createChallengerFromRequest(context, {
        body: readBody(event),
        authorization: event.headers.authorization,
      });
    case 'GET /arena/challengers/me/attempts':
      return getMyAttempts(context, event.headers.authorization);
    case 'GET /arena/stats':
      return getStats(context);
    case 'GET /arena/leaderboard':
      return getLeaderboardPage(context, event.queryStringParameters?.scope);
    case 'POST /arena/attempts':
      return submitAttempt(context, {
        body: readBody(event),
        authorization: event.headers.authorization,
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
