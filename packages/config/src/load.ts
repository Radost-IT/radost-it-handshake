import { paginateGetParametersByPath, SSMClient } from '@aws-sdk/client-ssm';
import { configKeyNames, configKeys, type ConfigKeyName, type RawConfig } from './keys';
import { ConfigError, parseConfig, type Config } from './parse';

type Env = Record<string, string | undefined>;

export function ssmPathForStage(stage: string): string {
  return `/handshake/${stage}`;
}

export function readConfigFromEnv(env: Env): RawConfig {
  const raw: RawConfig = {};
  for (const key of configKeyNames) {
    const value = env[configKeys[key].env];
    if (value !== undefined && value !== '') raw[key] = value;
  }
  return raw;
}

export async function readConfigFromSsm(client: SSMClient, path: string): Promise<RawConfig> {
  const valuesByName = new Map<string, string>();
  const pages = paginateGetParametersByPath(
    { client },
    { Path: path, Recursive: true, WithDecryption: true },
  );
  for await (const page of pages) {
    for (const parameter of page.Parameters ?? []) {
      if (parameter.Name && parameter.Value !== undefined) {
        valuesByName.set(parameter.Name, parameter.Value);
      }
    }
  }

  const raw: RawConfig = {};
  for (const key of configKeyNames) {
    const value = valuesByName.get(`${path}/${configKeys[key].ssm}`);
    if (value !== undefined) raw[key] = value;
  }
  return raw;
}

/**
 * Loads config from SSM when `HANDSHAKE_STAGE` is set (on AWS), otherwise from
 * environment variables (locally, filled from `.env`). Throws `ConfigError`
 * naming every missing or invalid key, never its value.
 */
export async function loadConfig(env: Env = process.env): Promise<Config> {
  const stage = env.HANDSHAKE_STAGE;
  if (stage === undefined) {
    return parseConfig(readConfigFromEnv(env), (key: ConfigKeyName) => configKeys[key].env);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(stage)) {
    throw new ConfigError('HANDSHAKE_STAGE must be lowercase letters, digits, or dashes');
  }

  const path = ssmPathForStage(stage);
  const raw = await readConfigFromSsm(new SSMClient({}), path);
  return parseConfig(raw, (key: ConfigKeyName) => `SSM parameter ${path}/${configKeys[key].ssm}`);
}
