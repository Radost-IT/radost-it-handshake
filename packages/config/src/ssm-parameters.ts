import type { ParameterType } from '@aws-sdk/client-ssm';
import { configKeyNames, configKeys } from './keys';
import { readConfigFromEnv, ssmPathForStage, type Env } from './load';
import { ConfigError, validatePresentConfigValues } from './parse';

export interface SsmParameter {
  name: string;
  type: ParameterType;
  value: string;
}

const SECRET_ENV_NAME = /_(SECRET|KEY|TOKEN|PASSWORD)$/;

// Read by CDK at deploy time, not by the app, so they sit outside the stage path.
// CloudFront only accepts a us-east-1 certificate; the API domain needs one in its own region.
const deployKeys = [
  {
    env: 'CERTIFICATE_ARN_US_EAST_1',
    name: '/handshake/certificates/us-east-1',
    format: /^arn:aws:acm:us-east-1:\d{12}:certificate\/[0-9a-f-]+$/,
    expected: 'an ACM certificate ARN in us-east-1',
  },
  {
    env: 'CERTIFICATE_ARN_EU_WEST_1',
    name: '/handshake/certificates/eu-west-1',
    format: /^arn:aws:acm:eu-west-1:\d{12}:certificate\/[0-9a-f-]+$/,
    expected: 'an ACM certificate ARN in eu-west-1',
  },
  {
    env: 'HOSTED_ZONE_ID',
    name: '/handshake/dns/hosted-zone-id',
    format: /^Z[0-9A-Z]{1,31}$/,
    expected: 'a Route 53 hosted zone ID',
  },
] as const;

export function ssmParameterTypeForEnvName(envName: string): ParameterType {
  return SECRET_ENV_NAME.test(envName) ? 'SecureString' : 'String';
}

/**
 * Builds the SSM parameters for a stage from environment variables. Validates
 * every value that is set and throws `ConfigError` like `loadConfig`. Keys with
 * an empty or missing value are left out, so `loadConfig` reports them later. Deploy-time values (certificate
 * ARNs, hosted zone ID) go to their shared paths, not under the stage.
 */
export function ssmParametersFromEnv(env: Env, stage: string): SsmParameter[] {
  return [...stageParametersFromEnv(env, stage), ...deployParametersFromEnv(env)];
}

function stageParametersFromEnv(env: Env, stage: string): SsmParameter[] {
  const path = ssmPathForStage(stage);
  const raw = readConfigFromEnv(env);
  validatePresentConfigValues(raw, (key) => configKeys[key].env);

  return configKeyNames.flatMap((key) => {
    const value = raw[key];
    if (value === undefined) return [];
    const { env: envName, ssm } = configKeys[key];
    return [{ name: `${path}/${ssm}`, type: ssmParameterTypeForEnvName(envName), value }];
  });
}

function deployParametersFromEnv(env: Env): SsmParameter[] {
  return deployKeys.flatMap(({ env: envName, name, format, expected }) => {
    const value = env[envName];
    if (value === undefined || value === '') return [];
    if (!format.test(value)) {
      throw new ConfigError(`Invalid configuration: ${envName} must be ${expected}`);
    }
    return [{ name, type: ssmParameterTypeForEnvName(envName), value }];
  });
}
