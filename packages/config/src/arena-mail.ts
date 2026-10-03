import { SSMClient } from '@aws-sdk/client-ssm';
import { z } from 'zod';
import type { ConfigKeyName } from './keys';
import type { Env } from './load';
import { ConfigError, zeptoMailApiUrlSchema, zeptoMailTokenSchema } from './parse';
import { readConfigValue } from './single-value';

export interface ArenaMailConfig {
  /** Sender of sign-in codes and access emails; its domain must be verified in ZeptoMail. */
  from: string;
  /** Receives every request to join the arena. */
  adminEmail: string;
  zeptoMail: { apiUrl: string; token: string };
}

async function readValue(
  key: ConfigKeyName,
  env: Env,
  client: SSMClient,
  check: { schema: z.ZodType; expected: string },
): Promise<string> {
  const { value, source } = await readConfigValue(key, env, client);
  if (value === undefined) throw new ConfigError(`Invalid configuration: ${source} is missing`);
  if (!check.schema.safeParse(value).success) {
    throw new ConfigError(`Invalid configuration: ${source} must be ${check.expected}`);
  }
  return value;
}

const emailAddress = { schema: z.email(), expected: 'an email address' };

/** Loads the arena's email settings without reading the PayPal secrets. */
export async function loadArenaMailConfig(
  env: Env = process.env,
  client: SSMClient = new SSMClient({}),
): Promise<ArenaMailConfig> {
  const [from, adminEmail, apiUrl, token] = await Promise.all([
    readValue('arenaEmailFrom', env, client, emailAddress),
    readValue('arenaAdminEmail', env, client, emailAddress),
    readValue('zeptoMailApiUrl', env, client, {
      schema: zeptoMailApiUrlSchema,
      expected: 'an https URL',
    }),
    readValue('zeptoMailToken', env, client, {
      schema: zeptoMailTokenSchema,
      expected: 'a ZeptoMail Send Mail token starting with "Zoho-enczapikey "',
    }),
  ]);
  return { from, adminEmail, zeptoMail: { apiUrl, token } };
}
