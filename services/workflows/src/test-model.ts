import type { LlmProvider, LlmRequest } from '@handshake/agents';

type Answer = (request: LlmRequest) => Record<string, unknown>;

/**
 * A model that answers each structured output by name. A list answers its
 * calls in order; a function answers every call.
 */
export function scriptedModel(
  answers: Record<string, Answer | Record<string, unknown>[]>,
): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    converse: (request) => {
      requests.push(request);
      const name = request.toolChoice?.type === 'tool' ? request.toolChoice.name : '';
      const answer = answers[name];
      const input = typeof answer === 'function' ? answer(request) : answer?.shift();
      if (input === undefined) throw new Error(`No scripted answer left for ${name}`);
      return Promise.resolve({
        content: [{ type: 'toolUse', toolUseId: `call-${requests.length}`, name, input }],
        stopReason: 'tool_use',
        usage: { inputTokens: 100, outputTokens: 20 },
      });
    },
  };
}
