import type { ParameterType } from '@aws-sdk/client-ssm';
import { configKeyNames, configKeys } from './keys';
import { readConfigFromEnv, ssmPathForStage, type Env } from './load';
import { parseConfig } from './parse';

export interface SsmParameter {
  name: string;
  type: ParameterType;
  value: string;
}

const SECRET_ENV_NAME = /_(SECRET|KEY|TOKEN|PASSWORD)$/;

export function ssmParameterTypeForEnvName(envName: string): ParameterType {
  return SECRET_ENV_NAME.test(envName) ? 'SecureString' : 'String';
}

/**
 * Builds the SSM parameters for a stage from environment variables. Validates
 * the whole config first and throws `ConfigError` like `loadConfig`. Keys with
 * an empty or missing value are left out.
 */
export function ssmParametersFromEnv(env: Env, stage: string): SsmParameter[] {
  const path = ssmPathForStage(stage);
  const raw = readConfigFromEnv(env);
  parseConfig(raw, (key) => configKeys[key].env);

  return configKeyNames.flatMap((key) => {
    const value = raw[key];
    if (value === undefined) return [];
    const { env: envName, ssm } = configKeys[key];
    return [{ name: `${path}/${ssm}`, type: ssmParameterTypeForEnvName(envName), value }];
  });
}
