import { SSMClient } from '@aws-sdk/client-ssm';
import { z } from 'zod';
import type { ConfigKeyName } from './keys';
import type { Env } from './load';
import { ConfigError } from './parse';
import { readConfigValue } from './single-value';

export interface ArenaMailConfig {
  /** Sender of sign-in codes and access emails; its domain must be verified in SES. */
  from: string;
  /** Receives every request to join the arena. */
  adminEmail: string;
}

async function readEmail(key: ConfigKeyName, env: Env, client: SSMClient): Promise<string> {
  const { value, source } = await readConfigValue(key, env, client);
  if (value === undefined) throw new ConfigError(`Invalid configuration: ${source} is missing`);
  if (!z.email().safeParse(value).success) {
    throw new ConfigError(`Invalid configuration: ${source} must be an email address`);
  }
  return value;
}

/** Loads the arena's email addresses without reading the PayPal secrets. */
export async function loadArenaMailConfig(
  env: Env = process.env,
  client: SSMClient = new SSMClient({}),
): Promise<ArenaMailConfig> {
  const [from, adminEmail] = await Promise.all([
    readEmail('arenaEmailFrom', env, client),
    readEmail('arenaAdminEmail', env, client),
  ]);
  return { from, adminEmail };
}
