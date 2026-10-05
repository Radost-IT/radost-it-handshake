import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Channel3 } from '@channel3/sdk';
import { createBedrockLlmProvider } from '@handshake/agents';
import { getProduct, searchProducts, type CatalogContext } from '@handshake/channel3';
import { loadConfig, requireChannel3ApiKey } from '@handshake/config';
import { z } from 'zod';
import {
  dealAgentsTaskSchema,
  runDealAgentsTask,
  type DealAgentsContext,
  type DealAgentsResult,
} from './deal-agents';
import { withDailyTokenBudget } from './token-budget';

const environment = z.object({ TABLE_NAME: z.string().min(1) }).parse(process.env);

const config = await loadConfig();

const table = {
  client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
  name: environment.TABLE_NAME,
};
const now = () => new Date().toISOString();

// Only deals without a seller shop the catalog, so a missing Channel3 key fails those deals alone.
let catalog: CatalogContext | undefined;
function channel3Catalog(): CatalogContext {
  catalog ??= {
    products: new Channel3({ apiKey: requireChannel3ApiKey(config) }).products,
    table,
    now: () => new Date(),
  };
  return catalog;
}

const bedrock = createBedrockLlmProvider(
  new BedrockRuntimeClient({ region: config.bedrock.region }),
  { fast: config.bedrock.modelFast, smart: config.bedrock.modelSmart },
);

const context: DealAgentsContext = {
  table,
  llm: withDailyTokenBudget(bedrock, {
    table,
    dailyTokenBudget: config.limits.dailyTokenBudget,
    now,
  }),
  catalog: {
    search: (query) => searchProducts(channel3Catalog(), query),
    get: (productId) => getProduct(channel3Catalog(), productId),
  },
  negotiationMaxTurns: config.limits.negotiationMaxTurns,
  now,
};

/** The agent steps of the DealLifecycle state machine. Errors fail the step. */
export async function handler(input: unknown): Promise<DealAgentsResult> {
  return runDealAgentsTask(context, dealAgentsTaskSchema.parse(input));
}
