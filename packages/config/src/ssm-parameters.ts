import type { ParameterType } from '@aws-sdk/client-ssm';
import { configKeyNames, configKeys } from './keys';
import { readConfigFromEnv, ssmPathForStage, type Env } from './load';
import { ConfigError, parseConfig } from './parse';

export interface SsmParameter {
  name: string;
  type: ParameterType;
  value: string;
}

const SECRET_ENV_NAME = /_(SECRET|KEY|TOKEN|PASSWORD)$/;

// Read by CDK at deploy time, not by the app, so they sit outside the stage path.
// CloudFront only accepts a us-east-1 certificate; the API domain needs one in its own region.
const certificateKeys = [
  {
    env: 'CERTIFICATE_ARN_US_EAST_1',
    name: '/handshake/certificates/us-east-1',
    region: 'us-east-1',
  },
  {
    env: 'CERTIFICATE_ARN_EU_WEST_1',
    name: '/handshake/certificates/eu-west-1',
    region: 'eu-west-1',
  },
] as const;

export function ssmParameterTypeForEnvName(envName: string): ParameterType {
  return SECRET_ENV_NAME.test(envName) ? 'SecureString' : 'String';
}

/**
 * Builds the SSM parameters for a stage from environment variables. Validates
 * the whole config first and throws `ConfigError` like `loadConfig`. Keys with
 * an empty or missing value are left out. Certificate ARNs go to their shared
 * paths, not under the stage.
 */
export function ssmParametersFromEnv(env: Env, stage: string): SsmParameter[] {
  return [...stageParametersFromEnv(env, stage), ...certificateParametersFromEnv(env)];
}

function stageParametersFromEnv(env: Env, stage: string): SsmParameter[] {
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

function certificateParametersFromEnv(env: Env): SsmParameter[] {
  return certificateKeys.flatMap(({ env: envName, name, region }) => {
    const value = env[envName];
    if (value === undefined || value === '') return [];
    if (!new RegExp(`^arn:aws:acm:${region}:\\d{12}:certificate/[0-9a-f-]+$`).test(value)) {
      throw new ConfigError(
        `Invalid configuration: ${envName} must be an ACM certificate ARN in ${region}`,
      );
    }
    return [{ name, type: ssmParameterTypeForEnvName(envName), value }];
  });
}
