import type { LlmProvider } from '@handshake/agents';
import { addTokensUsed, getTokensUsed, type StoreTable } from '@handshake/store';

// Step Functions sees this name as the error of a failed step. Minifying renames
// classes, so the name is a string and not the class name.
export const TOKEN_BUDGET_EXHAUSTED = 'TokenBudgetExhaustedError';

export class TokenBudgetExhaustedError extends Error {
  override name = TOKEN_BUDGET_EXHAUSTED;
}

export interface DailyTokenBudget {
  table: StoreTable;
  /** LLM tokens, input and output together, allowed per UTC day. */
  dailyTokenBudget: number;
  now: () => string;
}

/**
 * Refuses model calls once the day's tokens are used up. The check runs before
 * the call and the usage is added after it, so calls already running when the
 * budget runs out can pass it by at most their own token caps.
 */
export function withDailyTokenBudget(llm: LlmProvider, budget: DailyTokenBudget): LlmProvider {
  return {
    async converse(request) {
      const date = budget.now().slice(0, 10);
      const used = await getTokensUsed(budget.table, date);
      if (used >= budget.dailyTokenBudget) {
        throw new TokenBudgetExhaustedError(
          `The daily budget of ${budget.dailyTokenBudget} tokens is used up for ${date}`,
        );
      }
      const response = await llm.converse(request);
      await addTokensUsed(
        budget.table,
        date,
        response.usage.inputTokens + response.usage.outputTokens,
      );
      return response;
    },
  };
}
