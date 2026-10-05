import { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createBedrockLlmProvider } from '@handshake/agents';
import { loadConfig } from '@handshake/config';
import { money } from '@handshake/core';
import { createPayPalClient } from '@handshake/paypal';
import { z } from 'zod';
import {
  arenaTaskSchema,
  runArenaTask,
  type ArenaRunContext,
  type ArenaTaskResult,
} from './arena-run';
import { publishLiveEvent, type LivePublisher } from './live-events';
import { arenaTokenLimits, withDailyTokenBudget } from './token-budget';

const environment = z
  .object({ TABLE_NAME: z.string().min(1), LIVE_CALLBACK_URL: z.url() })
  .parse(process.env);

const config = await loadConfig();

const table = {
  client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
  name: environment.TABLE_NAME,
};
const now = () => new Date().toISOString();

const livePublisher: LivePublisher = {
  table,
  connections: new ApiGatewayManagementApiClient({ endpoint: environment.LIVE_CALLBACK_URL }),
  now: () => new Date(),
};

const bedrock = createBedrockLlmProvider(
  new BedrockRuntimeClient({ region: config.bedrock.region }),
  { fast: config.bedrock.modelFast, smart: config.bedrock.modelSmart },
);

const context: ArenaRunContext = {
  table,
  llm: withDailyTokenBudget(bedrock, {
    table,
    limits: arenaTokenLimits(config.limits.dailyTokenBudget),
    now,
  }),
  paypal: createPayPalClient(config.paypal),
  dealSource: config.arena.dealSource,
  negotiationMaxTurns: config.limits.negotiationMaxTurns,
  bountyLimits: {
    maxBounty: money(config.limits.maxBounty, 'USD'),
    dailyBudget: money(config.limits.dailyBountyBudget, 'USD'),
    recipientEmail: config.arena.recipientEmail,
  },
  publishLive: (topic, event) => publishLiveEvent(livePublisher, topic, event),
  now,
};

/** One step of the ArenaRun state machine. Errors fail the step so Step Functions can retry. */
export async function handler(input: unknown): Promise<ArenaTaskResult> {
  return runArenaTask(context, arenaTaskSchema.parse(input));
}
