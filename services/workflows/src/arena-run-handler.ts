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

const environment = z.object({ TABLE_NAME: z.string().min(1) }).parse(process.env);

const config = await loadConfig();

const context: ArenaRunContext = {
  table: {
    client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    name: environment.TABLE_NAME,
  },
  llm: createBedrockLlmProvider(new BedrockRuntimeClient({ region: config.bedrock.region }), {
    fast: config.bedrock.modelFast,
    smart: config.bedrock.modelSmart,
  }),
  paypal: createPayPalClient(config.paypal),
  dealSource: config.arena.dealSource,
  negotiationMaxTurns: config.limits.negotiationMaxTurns,
  bountyLimits: {
    maxBounty: money(config.limits.maxBounty, 'USD'),
    dailyBudget: money(config.limits.dailyBountyBudget, 'USD'),
    recipientEmail: config.arena.recipientEmail,
  },
  now: () => new Date().toISOString(),
};

/** One step of the ArenaRun state machine. Errors fail the step so Step Functions can retry. */
export async function handler(input: unknown): Promise<ArenaTaskResult> {
  return runArenaTask(context, arenaTaskSchema.parse(input));
}
