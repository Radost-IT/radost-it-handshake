import { SSMClient } from '@aws-sdk/client-ssm';
import type { ConfigKeyName } from './keys';
import type { Env } from './load';
import { ConfigError, hexSecretSchema } from './parse';
import { readConfigValue } from './single-value';

async function loadHexSecret(key: ConfigKeyName, env: Env, client: SSMClient): Promise<string> {
  const { value, source } = await readConfigValue(key, env, client);
  if (value === undefined) throw new ConfigError(`Invalid configuration: ${source} is missing`);
  if (!hexSecretSchema.safeParse(value).success) {
    throw new ConfigError(`Invalid configuration: ${source} must be 64 hex characters`);
  }
  return value;
}

/**
 * Loads the secret that signs the web forms' spam challenges and attempt
 * cookies. Reads only this one parameter, so the web server never sees the
 * PayPal or Channel3 secrets. Throws `ConfigError` naming the key, never its value.
 */
export function loadFormSigningSecret(
  env: Env = process.env,
  client: SSMClient = new SSMClient({}),
): Promise<string> {
  return loadHexSecret('formSigningSecret', env, client);
}

/**
 * Loads the header value CloudFront adds to every request it sends the web
 * server, so the server can tell CloudFront from a caller of its public
 * function URL. Returns null locally, where no CloudFront sits in front.
 */
export async function loadOriginVerifySecret(
  env: Env = process.env,
  client: SSMClient = new SSMClient({}),
): Promise<string | null> {
  if (env.HANDSHAKE_STAGE === undefined) return null;
  return loadHexSecret('originVerifySecret', env, client);
}
