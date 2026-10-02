import { z } from 'zod';
import type { LlmMessage, LlmProvider, ModelTier, TokenUsage } from './llm';

export class LlmOutputError extends Error {
  override name = 'LlmOutputError';
}

export interface GenerateObjectRequest<Schema extends z.ZodObject> {
  tier: ModelTier;
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  output: { name: string; description: string; schema: Schema };
}

/**
 * Asks the model for one object that matches the schema. The model must answer
 * by calling a single forced tool, so the reply is JSON, and zod checks it.
 * Throws LlmOutputError when the reply is cut off, refused, or invalid.
 */
export async function generateObject<Schema extends z.ZodObject>(
  provider: LlmProvider,
  request: GenerateObjectRequest<Schema>,
): Promise<{ value: z.infer<Schema>; usage: TokenUsage }> {
  const { output } = request;
  const response = await provider.converse({
    tier: request.tier,
    system: request.system,
    messages: request.messages,
    maxTokens: request.maxTokens,
    tools: [
      {
        name: output.name,
        description: output.description,
        inputSchema: toToolInputSchema(output.schema),
      },
    ],
    toolChoice: { type: 'tool', name: output.name },
  });
  if (response.stopReason !== 'tool_use') {
    throw new LlmOutputError(`Model stopped with ${response.stopReason} instead of ${output.name}`);
  }
  const call = response.content.find(
    (content) => content.type === 'toolUse' && content.name === output.name,
  );
  if (call?.type !== 'toolUse') throw new LlmOutputError(`Model did not call ${output.name}`);
  const parsed = output.schema.safeParse(call.input);
  if (!parsed.success) {
    throw new LlmOutputError(`${output.name} output is invalid: ${z.prettifyError(parsed.error)}`);
  }
  return { value: parsed.data, usage: response.usage };
}

// The model produces what the schema accepts, so the schema describes its input side.
function toToolInputSchema(schema: z.ZodObject): Record<string, unknown> {
  const jsonSchema: Record<string, unknown> = z.toJSONSchema(schema, { io: 'input' });
  delete jsonSchema.$schema;
  return jsonSchema;
}
