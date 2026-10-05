import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { createDealApiClient } from './deal-api-client';
import { createHandshakeMcpServer } from './server';

const usd = (value: string) => ({ currency: 'USD', value });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function connect(fetch: typeof globalThis.fetch): Promise<Client> {
  const api = createDealApiClient({
    apiUrl: 'https://api.example',
    apiKey: 'hs_sandbox_key',
    fetch,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createHandshakeMcpServer(api).connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const [first] = result.content as { type: string; text: string }[];
  return first?.text ?? '';
}

describe('Handshake MCP server', () => {
  it('offers no tool that approves, captures or refunds', async () => {
    const client = await connect(vi.fn());

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'get_deal',
      'list_deals',
      'open_deal',
      'submit_delivery_evidence',
    ]);
  });

  it('opens a deal with the API key and returns the buyer link', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse(201, {
        deal: { id: 'deal-1', state: 'NEGOTIATING' },
        accessToken: 'token-1',
        buyerUrl: 'https://handshake.example/deals/deal-1#token=token-1',
      }),
    );
    const client = await connect(fetch);

    const result = await client.callTool({
      name: 'open_deal',
      arguments: {
        goal: 'A steel water bottle',
        maxPrice: usd('50.00'),
        humanApprovalThreshold: usd('40.00'),
      },
    });

    expect(JSON.parse(textOf(result))).toEqual({
      deal: { id: 'deal-1', state: 'NEGOTIATING' },
      buyerUrl: 'https://handshake.example/deals/deal-1#token=token-1',
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://api.example/v1/deals');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer hs_sandbox_key' });
    expect(JSON.parse(init?.body as string)).toEqual({
      goal: 'A steel water bottle',
      mandate: {
        maxPrice: usd('50.00'),
        humanApprovalThreshold: usd('40.00'),
        blockedCategories: [],
      },
    });
  });

  it('returns the API error to the model as a tool error', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(jsonResponse(409, { error: 'Evidence for this deal was already sent' }));
    const client = await connect(fetch);

    const result = await client.callTool({
      name: 'submit_delivery_evidence',
      arguments: {
        dealId: 'deal-1',
        productId: 'prod-1',
        deliveredAt: '2026-10-05T10:00:00Z',
        invoiceTotal: usd('42.50'),
        description: 'A 750 ml steel bottle.',
      },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Evidence for this deal was already sent');
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.example/v1/deals/deal-1/evidence');
  });
});
