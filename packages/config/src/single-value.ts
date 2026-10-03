import { GetParameterCommand, type SSMClient } from '@aws-sdk/client-ssm';
import { configKeys, type ConfigKeyName } from './keys';
import { ssmPathForStage, type Env } from './load';

/**
 * Reads one config value: from the environment locally, or from its own SSM
 * parameter on AWS. Functions that need a single value use this, so their
 * Lambda can read that parameter only and never sees the other secrets.
 * The source names the variable or parameter for error messages.
 */
export async function readConfigValue(
  key: ConfigKeyName,
  env: Env,
  client: SSMClient,
): Promise<{ value: string | undefined; source: string }> {
  const { env: envName, ssm } = configKeys[key];
  const stage = env.HANDSHAKE_STAGE;
  if (stage === undefined) return { value: env[envName] || undefined, source: envName };

  const name = `${ssmPathForStage(stage)}/${ssm}`;
  const response = await client.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  return { value: response.Parameter?.Value || undefined, source: `SSM parameter ${name}` };
}
