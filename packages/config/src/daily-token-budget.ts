import { SSMClient } from '@aws-sdk/client-ssm';
import type { Env } from './load';
import { ConfigError } from './parse';
import { readConfigValue } from './single-value';

/**
 * Loads only the daily LLM token budget, for the arena API to refuse new
 * attempts once it is used up without reading the PayPal secrets.
 */
export async function loadDailyTokenBudget(
  env: Env = process.env,
  client: SSMClient = new SSMClient({}),
): Promise<number> {
  const { value, source } = await readConfigValue('dailyTokenBudget', env, client);
  if (value === undefined) throw new ConfigError(`Invalid configuration: ${source} is missing`);
  if (!/^[1-9]\d*$/.test(value.trim())) {
    throw new ConfigError(`Invalid configuration: ${source} must be a positive whole number`);
  }
  return Number(value);
}
