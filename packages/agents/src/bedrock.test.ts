import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, expect, it } from 'vitest';
import { createBedrockLlmProvider, LlmResponseError } from './bedrock';
import type { LlmRequest } from './llm';

const bedrock = mockClient(BedrockRuntimeClient);
const provider = createBedrockLlmProvider(new BedrockRuntimeClient({}), {
  fast: 'eu.fast-model',
  smart: 'eu.smart-model',
});

beforeEach(() => bedrock.reset());

const request: LlmRequest = {
  tier: 'smart',
  system: 'You are a seller.',
  messages: [
    { role: 'user', content: [{ text: 'Find me a kettle.', type: 'text' }] },
    {
      role: 'assistant',
      content: [
        { type: 'toolUse', toolUseId: 'call-1', name: 'search', input: { query: 'kettle' } },
      ],
    },
    {
      role: 'user',
      content: [{ type: 'toolResult', toolUseId: 'call-1', content: '[]', isError: false }],
    },
  ],
  tools: [
    {
      name: 'search',
      description: 'Search products.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    },
  ],
  maxTokens: 300,
};

function replyWith(content: object[], stopReason: string): void {
  bedrock.on(ConverseCommand).resolves({
    output: { message: { role: 'assistant', content } },
    stopReason,
    usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
  } as never);
}

it('sends the conversation to the model of the requested tier', async () => {
  replyWith([{ text: 'Done.' }], 'end_turn');

  await provider.converse(request);

  expect(bedrock.commandCalls(ConverseCommand)[0]?.args[0].input).toEqual({
    modelId: 'eu.smart-model',
    system: [{ text: 'You are a seller.' }],
    messages: [
      { role: 'user', content: [{ text: 'Find me a kettle.' }] },
      {
        role: 'assistant',
        content: [{ toolUse: { toolUseId: 'call-1', name: 'search', input: { query: 'kettle' } } }],
      },
      {
        role: 'user',
        content: [
          { toolResult: { toolUseId: 'call-1', content: [{ text: '[]' }], status: 'success' } },
        ],
      },
    ],
    toolConfig: {
      tools: [
        {
          toolSpec: {
            name: 'search',
            description: 'Search products.',
            inputSchema: { json: { type: 'object', properties: { query: { type: 'string' } } } },
          },
        },
      ],
      toolChoice: { auto: {} },
    },
    inferenceConfig: { maxTokens: 300 },
  });
});

it('forces a named tool when the request asks for it', async () => {
  replyWith([{ text: 'Done.' }], 'end_turn');

  await provider.converse({ ...request, toolChoice: { type: 'tool', name: 'search' } });

  expect(bedrock.commandCalls(ConverseCommand)[0]?.args[0].input.toolConfig?.toolChoice).toEqual({
    tool: { name: 'search' },
  });
});

it('sends no tool configuration when the request has no tools', async () => {
  replyWith([{ text: 'Done.' }], 'end_turn');

  await provider.converse({ ...request, tools: [] });

  expect(bedrock.commandCalls(ConverseCommand)[0]?.args[0].input.toolConfig).toBeUndefined();
});

it('returns text, tool calls and token usage', async () => {
  replyWith(
    [
      { text: 'Searching.' },
      { toolUse: { toolUseId: 'call-2', name: 'search', input: { query: 'mug' } } },
    ],
    'tool_use',
  );

  await expect(provider.converse(request)).resolves.toEqual({
    content: [
      { type: 'text', text: 'Searching.' },
      { type: 'toolUse', toolUseId: 'call-2', name: 'search', input: { query: 'mug' } },
    ],
    stopReason: 'tool_use',
    usage: { inputTokens: 120, outputTokens: 30 },
  });
});

it('reports a guardrail or content filter stop as a refusal', async () => {
  replyWith([], 'content_filtered');

  await expect(provider.converse(request)).resolves.toMatchObject({ stopReason: 'refused' });
});

it('fails on a stop reason the agents cannot act on', async () => {
  replyWith([], 'malformed_tool_use');

  await expect(provider.converse(request)).rejects.toThrow(LlmResponseError);
});
