import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { configKeys } from './keys';
import { ssmPathForStage, type Env } from './load';
import { ConfigError, formSigningSecretSchema } from './parse';

/**
 * Loads the secret that signs the web forms' spam challenges and attempt
 * cookies. Reads only this one parameter, so the web server never sees the
 * PayPal or Channel3 secrets. Throws `ConfigError` naming the key, never its value.
 */
export async function loadFormSigningSecret(
  env: Env = process.env,
  client: SSMClient = new SSMClient({}),
): Promise<string> {
  const { env: envName, ssm } = configKeys.formSigningSecret;
  const stage = env.HANDSHAKE_STAGE;

  if (stage === undefined) return parseSecret(env[envName], envName);

  const name = `${ssmPathForStage(stage)}/${ssm}`;
  const response = await client.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  return parseSecret(response.Parameter?.Value, `SSM parameter ${name}`);
}

function parseSecret(value: string | undefined, source: string): string {
  if (value === undefined || value === '') {
    throw new ConfigError(`Invalid configuration: ${source} is missing`);
  }
  if (!formSigningSecretSchema.safeParse(value).success) {
    throw new ConfigError(`Invalid configuration: ${source} must be 64 hex characters`);
  }
  return value;
}
