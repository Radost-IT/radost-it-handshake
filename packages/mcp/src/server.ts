import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { DealApiError, type DealApiClient } from './deal-api-client';

const moneyShape = z
  .object({
    currency: z.string().length(3).describe('ISO 4217 code, for example USD'),
    value: z.string().describe('Decimal string in PayPal format, for example "49.99"'),
  })
  .describe('An amount of money');

const openDealInput = {
  goal: z.string().min(3).max(500).describe('What the buyer wants, in plain words'),
  maxPrice: moneyShape.describe('The most the buyer agent may agree to pay'),
  humanApprovalThreshold: moneyShape.describe(
    'Prices at or above this wait for the person to approve them on the deal page',
  ),
  blockedCategories: z
    .array(z.string())
    .default([])
    .describe('Product categories the buyer agent must never buy'),
  sellerId: z
    .string()
    .optional()
    .describe('A sandbox seller to negotiate with. Leave empty to shop the catalog'),
};

const dealIdInput = { dealId: z.string().min(1).describe('The deal ID from open_deal') };

const evidenceInput = {
  ...dealIdInput,
  productId: z.string().min(1).describe('The product ID from the signed contract'),
  deliveredAt: z.iso.datetime({ offset: true }).describe('When the item was delivered'),
  invoiceTotal: moneyShape.describe('The total on the invoice'),
  description: z.string().min(1).max(4000).describe('What was delivered, as the seller states it'),
};

function asText(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/** API errors go back to the model as a tool error, so it can tell the person what went wrong. */
async function answer(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return asText(await run());
  } catch (error) {
    if (!(error instanceof DealApiError)) throw error;
    return { isError: true, content: [{ type: 'text', text: error.message }] };
  }
}

/**
 * The Handshake tools for an AI shopping agent. The agent can open deals,
 * follow them and act as the sandbox seller. Approving a price, approving the
 * PayPal checkout and deciding an escalation stay with the person on the deal
 * page, so no tool here can make money move.
 */
export function createHandshakeMcpServer(client: DealApiClient): McpServer {
  const server = new McpServer({ name: 'handshake', version: '1.0.0' });

  server.registerTool(
    'open_deal',
    {
      title: 'Open a deal',
      description:
        'Starts a Handshake deal. A buyer agent finds the product and negotiates within the budget. ' +
        'Give the returned buyerUrl to the person: they approve the PayPal checkout there, and the ' +
        'money stays authorized, not captured, until delivery is verified.',
      inputSchema: openDealInput,
    },
    ({ goal, maxPrice, humanApprovalThreshold, blockedCategories, sellerId }) =>
      answer(() =>
        client.openDeal({
          goal,
          mandate: { maxPrice, humanApprovalThreshold, blockedCategories },
          ...(sellerId === undefined ? {} : { sellerId }),
        }),
      ),
  );

  server.registerTool(
    'list_deals',
    {
      title: 'List deals',
      description: 'Lists the deals opened with this API key, newest first.',
      annotations: { readOnlyHint: true },
    },
    () => answer(() => client.listDeals()),
  );

  server.registerTool(
    'get_deal',
    {
      title: 'Get a deal',
      description:
        'Returns one deal: its state, signed contract, escrow hold, negotiation, delivery evidence, ' +
        'and every PayPal call with its debug_id.',
      inputSchema: dealIdInput,
      annotations: { readOnlyHint: true },
    },
    ({ dealId }) => answer(() => client.getDeal(dealId)),
  );

  server.registerTool(
    'submit_delivery_evidence',
    {
      title: 'Submit delivery evidence',
      description:
        'In the sandbox, plays the seller and reports the delivery of a deal that waits for it. ' +
        'The verifier agent checks the evidence against the contract; policy code then captures ' +
        'or voids the payment. Evidence can be sent once per deal.',
      inputSchema: evidenceInput,
    },
    ({ dealId, ...evidence }) =>
      answer(async () => {
        await client.submitEvidence(dealId, evidence);
        return { status: 'accepted', next: 'Call get_deal to follow the verification.' };
      }),
  );

  return server;
}
