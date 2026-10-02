export type ModelTier = 'fast' | 'smart';

export type LlmContent =
  | { type: 'text'; text: string }
  | { type: 'toolUse'; toolUseId: string; name: string; input: unknown }
  | { type: 'toolResult'; toolUseId: string; content: string; isError: boolean };

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: LlmContent[];
}

export interface LlmTool {
  name: string;
  description: string;
  /** JSON Schema of the tool input; it must describe an object. */
  inputSchema: Record<string, unknown>;
}

export type LlmToolChoice = { type: 'auto' } | { type: 'tool'; name: string };

export interface LlmRequest {
  tier: ModelTier;
  system: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  toolChoice?: LlmToolChoice;
  maxTokens: number;
}

export type LlmStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refused';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmResponse {
  content: LlmContent[];
  stopReason: LlmStopReason;
  usage: TokenUsage;
}

/** Agents talk to a model only through this interface, so tests and evals can swap the model out. */
export interface LlmProvider {
  converse(request: LlmRequest): Promise<LlmResponse>;
}
