import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ProductCatalog } from '@handshake/agents';
import { createDeal, money, transitionDeal, type Deal } from '@handshake/core';
import { mandate, verifyingDeal } from '@handshake/core/testing';
import type { DealBrief, Seller } from '@handshake/store';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { DealRecordMissingError, runDealAgentsTask, type DealAgentsContext } from './deal-agents';
import { scriptedModel } from './test-model';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };
const now = '2026-10-05T12:00:00.000Z';

const listing = {
  productId: 'c3-bottle',
  title: 'Steel water bottle',
  description: 'A 750 ml steel bottle with a lid.',
  categoryPath: ['home', 'kitchen'],
  listPrice: money('45.00', 'USD'),
};
const seller: Seller = {
  sellerId: 'seller-1',
  name: 'Mara',
  persona: 'Warm.',
  floorPrice: money('38.00', 'USD'),
  listing,
};
const emptyCatalog: ProductCatalog = {
  search: () => Promise.resolve([]),
  get: () => Promise.resolve(undefined),
};

function negotiatingDeal(): Deal {
  const { deal } = createDeal('deal-1', mandate, now);
  return transitionDeal(deal, { to: 'NEGOTIATING' }, now, 'Opened through the Deal API').deal;
}

function store(deal: Deal, records: Record<string, Record<string, unknown>> = {}): void {
  dynamodb.on(GetCommand).callsFake((input: { Key: { pk: string; sk: string } }) => {
    if (input.Key.pk === `DEAL#${deal.id}` && input.Key.sk === 'META') {
      return { Item: { ...input.Key, ...deal } };
    }
    if (input.Key.pk.startsWith('SELLER#')) return { Item: records.SELLER };
    return { Item: records[input.Key.sk] };
  });
}

function context(
  llm: DealAgentsContext['llm'],
  catalog: DealAgentsContext['catalog'] = emptyCatalog,
): DealAgentsContext {
  return { table, llm, catalog, negotiationMaxTurns: 6, now: () => now };
}

function savedStates(): string[] {
  return dynamodb.commandCalls(TransactWriteCommand).map((call) => {
    const item = call.args[0].input.TransactItems?.[0]?.Put?.Item;
    return String(item?.state);
  });
}

function savedNegotiations() {
  return dynamodb
    .commandCalls(PutCommand)
    .map((call) => call.args[0].input.Item)
    .filter((item) => item?.sk === 'NEGOTIATION');
}

const brief = (sellerId: string | null): DealBrief => ({
  goal: 'A steel water bottle',
  sellerId,
  buyerId: 'dev-1',
});

beforeEach(() => {
  dynamodb.reset();
  dynamodb.on(PutCommand).resolves({});
  dynamodb.on(TransactWriteCommand).resolves({});
});

describe('Negotiate', () => {
  it('negotiates with the chosen seller and signs a contract within the mandate', async () => {
    store(negotiatingDeal(), { BRIEF: brief('seller-1'), SELLER: seller });
    const llm = scriptedModel({
      negotiation_move: [
        { action: 'OFFER', price: '40.00', message: 'Would you take 40?' },
        { action: 'ACCEPT', message: 'Deal.' },
      ],
      acceptance_criteria: [{ criteria: ['The bottle holds 750 ml'] }],
    });

    const result = await runDealAgentsTask(context(llm), { task: 'Negotiate', dealId: 'deal-1' });

    expect(result).toEqual({ state: 'AUTHORIZING' });
    expect(savedStates()).toEqual(['AUTHORIZING']);
    const last = savedNegotiations().at(-1);
    expect(last).toMatchObject({
      sellerName: 'Mara',
      outcome: 'The buyer and the seller agreed on a price',
    });
    expect(last?.turns).toHaveLength(2);
    expect(JSON.stringify(savedNegotiations())).not.toContain('38.00');
  });

  it('abandons the deal when the buyer agent finds nothing in the catalog', async () => {
    store(negotiatingDeal(), { BRIEF: brief(null) });
    // The shopper picks its own tool, so the scripted model, which answers by forced tool name, does not fit.
    const llm: DealAgentsContext['llm'] = {
      converse: () =>
        Promise.resolve({
          content: [
            {
              type: 'toolUse',
              toolUseId: 'call-1',
              name: 'give_up',
              input: { reason: 'Nothing fits the goal' },
            },
          ],
          stopReason: 'tool_use',
          usage: { inputTokens: 10, outputTokens: 5 },
        }),
    };

    const result = await runDealAgentsTask(context(llm), { task: 'Negotiate', dealId: 'deal-1' });

    expect(result).toEqual({ state: 'ABANDONED' });
    expect(savedNegotiations()).toHaveLength(0);
  });

  it('asks for a seller ID when product search is not set up', async () => {
    store(negotiatingDeal(), { BRIEF: brief(null) });

    const result = await runDealAgentsTask(context(scriptedModel({}), null), {
      task: 'Negotiate',
      dealId: 'deal-1',
    });

    expect(result).toEqual({ state: 'ABANDONED' });
    const change =
      dynamodb.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems?.[1]?.Put?.Item;
    expect(change?.reason).toContain('with a seller ID');
  });

  it('abandons the deal when a party walks away', async () => {
    store(negotiatingDeal(), { BRIEF: brief('seller-1'), SELLER: seller });
    const llm = scriptedModel({
      negotiation_move: [{ action: 'WALK_AWAY', message: 'Too expensive.' }],
    });

    const result = await runDealAgentsTask(context(llm), { task: 'Negotiate', dealId: 'deal-1' });

    expect(result).toEqual({ state: 'ABANDONED' });
    expect(savedNegotiations().at(-1)).toMatchObject({ outcome: 'The buyer walked away' });
  });

  it('reports the state of a deal that already left negotiation', async () => {
    store(verifyingDeal());

    const result = await runDealAgentsTask(context(scriptedModel({})), {
      task: 'Negotiate',
      dealId: 'deal-1',
    });

    expect(result).toEqual({ state: 'VERIFYING' });
    expect(savedStates()).toEqual([]);
  });
});

describe('Verify', () => {
  it('returns the verifier proposal without settling', async () => {
    store(verifyingDeal(), {
      EVIDENCE: {
        productId: 'prod-1',
        deliveredAt: '2026-10-05T09:00:00Z',
        invoiceTotal: money('42.50', 'USD'),
        description: 'A 750 ml bottle with its lid.',
      },
    });
    const llm = scriptedModel({
      criterion_verdict: () => ({ met: true, confidence: 0.95, rationale: 'Shown.' }),
    });

    const result = await runDealAgentsTask(context(llm), { task: 'Verify', dealId: 'deal-1' });

    expect(result).toMatchObject({ proposal: { action: 'CAPTURE' } });
    expect(savedStates()).toEqual([]);
  });

  it('fails when no evidence was saved', async () => {
    store(verifyingDeal());

    await expect(
      runDealAgentsTask(context(scriptedModel({})), { task: 'Verify', dealId: 'deal-1' }),
    ).rejects.toThrow(DealRecordMissingError);
  });
});
