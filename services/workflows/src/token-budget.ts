import type { LlmProvider } from '@handshake/agents';
import {
  addTokensUsed,
  arenaTokenLimit,
  getTokensUsed,
  type StoreTable,
  type TokenPool,
} from '@handshake/store';

// Step Functions sees this name as the error of a failed step. Minifying renames
// classes, so the name is a string and not the class name.
export const TOKEN_BUDGET_EXHAUSTED = 'TokenBudgetExhaustedError';

export class TokenBudgetExhaustedError extends Error {
  override name = TOKEN_BUDGET_EXHAUSTED;
}

export interface TokenLimit {
  pool: TokenPool;
  /** LLM tokens, input and output together, allowed per UTC day. */
  tokens: number;
}

export interface DailyTokenBudget {
  table: StoreTable;
  limits: readonly TokenLimit[];
  now: () => string;
}

export function dealTokenLimits(dailyTokenBudget: number): TokenLimit[] {
  return [{ pool: 'all', tokens: dailyTokenBudget }];
}

export function arenaTokenLimits(dailyTokenBudget: number): TokenLimit[] {
  return [
    { pool: 'all', tokens: dailyTokenBudget },
    { pool: 'arena', tokens: arenaTokenLimit(dailyTokenBudget) },
  ];
}

/**
 * Refuses model calls once any of the day's limits is used up. The check runs
 * before the call and the usage is added after it, so calls already running
 * when a limit runs out can pass it by at most their own token caps.
 */
export function withDailyTokenBudget(llm: LlmProvider, budget: DailyTokenBudget): LlmProvider {
  return {
    async converse(request) {
      const date = budget.now().slice(0, 10);
      const used = await Promise.all(
        budget.limits.map((limit) => getTokensUsed(budget.table, date, limit.pool)),
      );
      const exhausted = budget.limits.find((limit, index) => (used[index] ?? 0) >= limit.tokens);
      if (exhausted) {
        throw new TokenBudgetExhaustedError(
          `The daily ${exhausted.pool} budget of ${exhausted.tokens} tokens is used up for ${date}`,
        );
      }
      const response = await llm.converse(request);
      const tokens = response.usage.inputTokens + response.usage.outputTokens;
      await Promise.all(
        budget.limits.map((limit) => addTokensUsed(budget.table, date, limit.pool, tokens)),
      );
      return response;
    },
  };
}
