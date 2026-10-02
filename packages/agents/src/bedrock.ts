import {
  ConverseCommand,
  type BedrockRuntimeClient,
  type ContentBlock,
  type ConverseCommandOutput,
  type Message,
  type StopReason,
  type Tool,
  type ToolConfiguration,
  type ToolUseBlock,
} from '@aws-sdk/client-bedrock-runtime';
import type {
  LlmContent,
  LlmMessage,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmStopReason,
  ModelTier,
} from './llm';

export class LlmResponseError extends Error {
  override name = 'LlmResponseError';
}

/** Bedrock Converse behind the LlmProvider interface. Model IDs come from config. */
export function createBedrockLlmProvider(
  client: BedrockRuntimeClient,
  models: Record<ModelTier, string>,
): LlmProvider {
  return {
    async converse(request) {
      const response = await client.send(
        new ConverseCommand({
          modelId: models[request.tier],
          system: [{ text: request.system }],
          messages: request.messages.map(toBedrockMessage),
          toolConfig: toToolConfiguration(request),
          inferenceConfig: { maxTokens: request.maxTokens },
        }),
      );
      return fromBedrockResponse(response);
    },
  };
}

function toBedrockMessage(message: LlmMessage): Message {
  return { role: message.role, content: message.content.map(toBedrockContent) };
}

function toBedrockContent(content: LlmContent): ContentBlock {
  switch (content.type) {
    case 'text':
      return { text: content.text };
    case 'toolUse':
      return {
        toolUse: {
          toolUseId: content.toolUseId,
          name: content.name,
          input: toDocument(content.input),
        },
      };
    case 'toolResult':
      return {
        toolResult: {
          toolUseId: content.toolUseId,
          content: [{ text: content.content }],
          status: content.isError ? 'error' : 'success',
        },
      };
  }
}

function toToolConfiguration(request: LlmRequest): ToolConfiguration | undefined {
  if (!request.tools?.length) return undefined;
  const tools = request.tools.map((tool): Tool => ({
    toolSpec: {
      name: tool.name,
      description: tool.description,
      inputSchema: { json: toDocument(tool.inputSchema) },
    },
  }));
  const choice = request.toolChoice;
  if (choice?.type === 'tool') return { tools, toolChoice: { tool: { name: choice.name } } };
  return { tools, toolChoice: { auto: {} } };
}

function fromBedrockResponse(response: ConverseCommandOutput): LlmResponse {
  const message = response.output?.message;
  if (!message) throw new LlmResponseError('Bedrock returned no message');
  return {
    content: (message.content ?? []).flatMap(fromBedrockContent),
    stopReason: toStopReason(response.stopReason),
    usage: {
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0,
    },
  };
}

// Only text and tool calls carry meaning for the agents; other blocks, such as
// reasoning, are not requested and are dropped.
function fromBedrockContent(block: ContentBlock): LlmContent[] {
  if (block.text !== undefined) return [{ type: 'text', text: block.text }];
  if (block.toolUse) {
    const { toolUseId, name, input } = block.toolUse;
    if (!toolUseId || !name)
      throw new LlmResponseError('Bedrock returned a tool call without a name');
    return [{ type: 'toolUse', toolUseId, name, input }];
  }
  return [];
}

function toStopReason(reason: StopReason | undefined): LlmStopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'content_filtered':
    case 'guardrail_intervened':
      return 'refused';
    default:
      throw new LlmResponseError(`Bedrock stopped with ${String(reason)}`);
  }
}

type JsonDocument = NonNullable<ToolUseBlock['input']>;

// The SDK has its own JSON document type; a JSON round trip yields a value that fits it.
function toDocument(value: unknown): JsonDocument {
  return JSON.parse(JSON.stringify(value)) as JsonDocument;
}
