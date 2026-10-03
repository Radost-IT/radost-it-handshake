import { SSMClient } from '@aws-sdk/client-ssm';
import type { Env } from './load';
import { ConfigError, formSigningSecretSchema } from './parse';
import { readConfigValue } from './single-value';

/**
 * Loads the secret that signs the web forms' spam challenges and attempt
 * cookies. Reads only this one parameter, so the web server never sees the
 * PayPal or Channel3 secrets. Throws `ConfigError` naming the key, never its value.
 */
export async function loadFormSigningSecret(
  env: Env = process.env,
  client: SSMClient = new SSMClient({}),
): Promise<string> {
  const { value, source } = await readConfigValue('formSigningSecret', env, client);
  if (value === undefined) throw new ConfigError(`Invalid configuration: ${source} is missing`);
  if (!formSigningSecretSchema.safeParse(value).success) {
    throw new ConfigError(`Invalid configuration: ${source} must be 64 hex characters`);
  }
  return value;
}
