import { formatMoney, hasSameCurrency, type Mandate } from '@handshake/core';
import { z } from 'zod';
import { LlmOutputError, toToolInputSchema } from './generate-object';
import type { LlmContent, LlmMessage, LlmProvider, LlmTool, TokenUsage } from './llm';
import type { Listing } from './negotiator';
import { untrustedDataRule, wrapUntrustedData } from './untrusted-data';

/** Where the shopper finds products. The Channel3 catalog implements it in production. */
export interface ProductCatalog {
  search(query: string): Promise<Listing[]>;
  get(productId: string): Promise<Listing | undefined>;
}

export type ShoppingResult =
  | { found: true; listing: Listing; reason: string; usage: TokenUsage }
  | { found: false; reason: string; usage: TokenUsage };

// Each step is one model call; a few searches and lookups are enough to pick a product.
const MAX_STEPS = 6;
const MAX_TOKENS_PER_STEP = 800;

const searchInput = z.object({
  query: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .describe('A short product search, such as "steel water bottle".'),
});
const getInput = z.object({
  productId: z.string().trim().min(1).max(200).describe('A product ID from a search result.'),
});
const chooseInput = z.object({
  productId: z.string().trim().min(1).max(200).describe('The product ID to negotiate for.'),
  reason: z.string().trim().min(1).max(400).describe('Why this product fits the goal.'),
});
const giveUpInput = z.object({
  reason: z.string().trim().min(1).max(400).describe('Why no product fits the goal.'),
});

const tool = (name: string, description: string, schema: z.ZodObject): LlmTool => ({
  name,
  description,
  inputSchema: toToolInputSchema(schema),
});

const tools: LlmTool[] = [
  tool('search_products', 'Search the product catalog.', searchInput),
  tool('get_product', 'Read the full details of one product.', getInput),
  tool('choose_product', 'Pick the product to negotiate for. This ends the search.', chooseInput),
  tool('give_up', 'Stop when no product fits the goal. This ends the search.', giveUpInput),
];

interface Search {
  goal: string;
  mandate: Mandate;
  catalog: ProductCatalog;
}

/**
 * Lets the buyer agent search the catalog and pick one product for the goal.
 * Products the mandate rules out are removed before the model sees them, and
 * the model can only choose a product it was shown.
 */
export async function findProductForGoal(
  provider: LlmProvider,
  search: Search,
): Promise<ShoppingResult> {
  const system = [
    'You are a buyer agent shopping for a person. Find the one product that best fits their goal.',
    `Their budget is ${formatMoney(search.mandate.maxPrice)}. Prices are negotiable, so a listing a little above the budget can still work.`,
    'Search with short queries, read the details of promising products, then choose one or give up.',
    untrustedDataRule,
  ].join('\n');
  const messages: LlmMessage[] = [
    {
      role: 'user',
      content: [{ type: 'text', text: wrapUntrustedData('buyer goal', search.goal) }],
    },
  ];
  const shown = new Map<string, Listing>();
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await provider.converse({
      tier: 'fast',
      system,
      messages,
      tools,
      toolChoice: { type: 'auto' },
      maxTokens: MAX_TOKENS_PER_STEP,
    });
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    const calls = response.content.filter((content) => content.type === 'toolUse');
    if (response.stopReason !== 'tool_use' || calls.length === 0) {
      throw new LlmOutputError(`Shopper stopped with ${response.stopReason} without choosing`);
    }

    const ending = calls.map((call) => endingFor(call, shown)).find((result) => result !== null);
    if (ending) return { ...ending, usage };

    messages.push({ role: 'assistant', content: response.content });
    const results = await Promise.all(calls.map((call) => runTool(call, search, shown)));
    messages.push({ role: 'user', content: results });
  }
  return { found: false, reason: `No product chosen within ${String(MAX_STEPS)} steps`, usage };
}

type ToolCall = Extract<LlmContent, { type: 'toolUse' }>;
type ToolResult = Extract<LlmContent, { type: 'toolResult' }>;
type Ending = { found: true; listing: Listing; reason: string } | { found: false; reason: string };

function endingFor(call: ToolCall, shown: Map<string, Listing>): Ending | null {
  if (call.name === 'give_up') {
    return { found: false, reason: parseToolInput(call, giveUpInput).reason };
  }
  if (call.name !== 'choose_product') return null;
  const { productId, reason } = parseToolInput(call, chooseInput);
  const listing = shown.get(productId);
  if (!listing) throw new LlmOutputError(`Shopper chose product ${productId} it was never shown`);
  return { found: true, listing, reason };
}

async function runTool(
  call: ToolCall,
  search: Search,
  shown: Map<string, Listing>,
): Promise<ToolResult> {
  const answer = (content: string): ToolResult => ({
    type: 'toolResult',
    toolUseId: call.toolUseId,
    content,
    isError: false,
  });
  const refuse = (content: string): ToolResult => ({ ...answer(content), isError: true });
  if (call.name === 'search_products') {
    const input = searchInput.safeParse(call.input);
    if (!input.success) return refuse(z.prettifyError(input.error));
    const listings = (await search.catalog.search(input.data.query)).filter((listing) =>
      isAllowed(listing, search.mandate),
    );
    for (const listing of listings) shown.set(listing.productId, listing);
    return answer(listings.length ? listings.map(summarize).join('\n\n') : 'No matching products.');
  }
  if (call.name === 'get_product') {
    const input = getInput.safeParse(call.input);
    if (!input.success) return refuse(z.prettifyError(input.error));
    const listing = await search.catalog.get(input.data.productId);
    if (!listing || !isAllowed(listing, search.mandate)) return refuse('Product not available.');
    shown.set(listing.productId, listing);
    return answer(describeListing(listing));
  }
  return refuse(`Unknown tool ${call.name}`);
}

function parseToolInput<Schema extends z.ZodObject>(
  call: ToolCall,
  schema: Schema,
): z.infer<Schema> {
  const parsed = schema.safeParse(call.input);
  if (!parsed.success) {
    throw new LlmOutputError(`${call.name} input is invalid: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

// The mandate is checked again on the agreed terms; this only keeps the model from wasting steps.
function isAllowed(listing: Listing, mandate: Mandate): boolean {
  return (
    hasSameCurrency(listing.listPrice, mandate.maxPrice) &&
    !listing.categoryPath.some((slug) => mandate.blockedCategories.includes(slug))
  );
}

// Prices and IDs are ours after validation; titles and descriptions are the merchant's words.
function summarize(listing: Listing): string {
  return [
    `Product ID: ${listing.productId}, listed at ${formatMoney(listing.listPrice)}`,
    wrapUntrustedData('product title', listing.title),
  ].join('\n');
}

function describeListing(listing: Listing): string {
  return [
    `Product ID: ${listing.productId}, listed at ${formatMoney(listing.listPrice)}`,
    `Category: ${listing.categoryPath.join(' > ')}`,
    wrapUntrustedData('product listing', `${listing.title}\n${listing.description}`),
  ].join('\n');
}
