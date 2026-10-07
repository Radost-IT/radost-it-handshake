import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Channel3 } from '@channel3/sdk';
import { createBedrockLlmProvider, type ProductCatalog } from '@handshake/agents';
import { getProduct, searchProducts, type CatalogContext } from '@handshake/channel3';
import { loadConfig } from '@handshake/config';
import { z } from 'zod';
import {
  dealAgentsTaskSchema,
  runDealAgentsTask,
  type DealAgentsContext,
  type DealAgentsResult,
} from './deal-agents';
import { dealTokenLimits, withDailyTokenBudget } from './token-budget';

const environment = z.object({ TABLE_NAME: z.string().min(1) }).parse(process.env);

const config = await loadConfig();

const table = {
  client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
  name: environment.TABLE_NAME,
};
const now = () => new Date().toISOString();

// Only deals without a seller shop the catalog, so a missing Channel3 key fails those deals alone.
function channel3Catalog(apiKey: string): ProductCatalog {
  const catalog: CatalogContext = {
    products: new Channel3({ apiKey }).products,
    table,
    now: () => new Date(),
  };
  return {
    search: (query) => searchProducts(catalog, query),
    get: (productId) => getProduct(catalog, productId),
  };
}

const bedrock = createBedrockLlmProvider(
  new BedrockRuntimeClient({ region: config.bedrock.region }),
  { fast: config.bedrock.modelFast, smart: config.bedrock.modelSmart },
);

const context: DealAgentsContext = {
  table,
  llm: withDailyTokenBudget(bedrock, {
    table,
    limits: dealTokenLimits(config.limits.dailyTokenBudget),
    now,
  }),
  catalog: config.channel3.apiKey === undefined ? null : channel3Catalog(config.channel3.apiKey),
  negotiationMaxTurns: config.limits.negotiationMaxTurns,
  now,
};

/** The agent steps of the DealLifecycle state machine. Errors fail the step. */
export async function handler(input: unknown): Promise<DealAgentsResult> {
  return runDealAgentsTask(context, dealAgentsTaskSchema.parse(input));
}
