import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { generateObject, LlmOutputError } from './generate-object';
import type { LlmContent, LlmProvider, LlmRequest, LlmStopReason } from './llm';

const offerSchema = z.object({
  price: z.string().regex(/^\d+\.\d{2}$/),
  message: z.string().max(500),
});

function providerReplying(
  content: LlmContent[],
  stopReason: LlmStopReason = 'tool_use',
): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    converse: (request) => {
      requests.push(request);
      return Promise.resolve({
        content,
        stopReason,
        usage: { inputTokens: 200, outputTokens: 40 },
      });
    },
  };
}

const request = {
  tier: 'fast' as const,
  system: 'You are a seller.',
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Offer 40.00' }] }],
  maxTokens: 400,
  output: { name: 'make_offer', description: 'Reply to the buyer.', schema: offerSchema },
};

const offerCall = (input: unknown): LlmContent => ({
  type: 'toolUse',
  toolUseId: 'call-1',
  name: 'make_offer',
  input,
});

it('forces the output tool and describes it with the JSON Schema of the zod schema', async () => {
  const provider = providerReplying([offerCall({ price: '45.00', message: 'Meet me at 45.' })]);

  await generateObject(provider, request);

  expect(provider.requests[0]).toMatchObject({
    tier: 'fast',
    maxTokens: 400,
    toolChoice: { type: 'tool', name: 'make_offer' },
    tools: [
      {
        name: 'make_offer',
        description: 'Reply to the buyer.',
        inputSchema: {
          type: 'object',
          properties: { price: { type: 'string' }, message: { type: 'string', maxLength: 500 } },
          required: ['price', 'message'],
        },
      },
    ],
  });
  expect(provider.requests[0]?.tools?.[0]?.inputSchema).not.toHaveProperty('$schema');
});

it('returns the parsed object and the token usage', async () => {
  const provider = providerReplying([offerCall({ price: '45.00', message: 'Meet me at 45.' })]);

  await expect(generateObject(provider, request)).resolves.toEqual({
    value: { price: '45.00', message: 'Meet me at 45.' },
    usage: { inputTokens: 200, outputTokens: 40 },
  });
});

describe('fails with LlmOutputError', () => {
  it('when the output does not match the schema', async () => {
    const provider = providerReplying([offerCall({ price: '45', message: 'Meet me at 45.' })]);

    await expect(generateObject(provider, request)).rejects.toThrow(LlmOutputError);
  });

  it('when the reply hit the token limit', async () => {
    const provider = providerReplying([offerCall({ price: '45.00' })], 'max_tokens');

    await expect(generateObject(provider, request)).rejects.toThrow('stopped with max_tokens');
  });

  it('when the model refused', async () => {
    const provider = providerReplying([], 'refused');

    await expect(generateObject(provider, request)).rejects.toThrow(LlmOutputError);
  });
});
