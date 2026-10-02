import { describe, expect, it } from 'vitest';
import { ConfigError } from './parse';
import { ssmParametersFromEnv, ssmParameterTypeForEnvName } from './ssm-parameters';

const validEnv = {
  PAYPAL_CLIENT_ID: 'client-id',
  PAYPAL_CLIENT_SECRET: 'client-secret-value',
  PAYPAL_BASE_URL: 'https://api-m.sandbox.paypal.com',
  PAYPAL_WEBHOOK_ID: '',
  CHANNEL3_API_KEY: 'channel3-key-value',
  BEDROCK_REGION: 'eu-west-1',
  BEDROCK_MODEL_FAST: 'eu.fast-model',
  BEDROCK_MODEL_SMART: 'eu.smart-model',
  DAILY_TOKEN_BUDGET: '2000000',
  NEGOTIATION_MAX_TURNS: '8',
};

const usEast1CertificateArn =
  'arn:aws:acm:us-east-1:123456789012:certificate/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b';

describe('ssmParameterTypeForEnvName', () => {
  it.each(['PAYPAL_CLIENT_SECRET', 'CHANNEL3_API_KEY', 'GITHUB_TOKEN', 'DB_PASSWORD'])(
    'stores %s as SecureString',
    (envName) => {
      expect(ssmParameterTypeForEnvName(envName)).toBe('SecureString');
    },
  );

  it.each(['PAYPAL_CLIENT_ID', 'DAILY_TOKEN_BUDGET', 'BEDROCK_MODEL_FAST'])(
    'stores %s as String',
    (envName) => {
      expect(ssmParameterTypeForEnvName(envName)).toBe('String');
    },
  );
});

describe('ssmParametersFromEnv', () => {
  it('maps every set key to its stage path and skips empty values', () => {
    const parameters = ssmParametersFromEnv(validEnv, 'prod');

    expect(parameters).toHaveLength(9);
    expect(parameters.map((parameter) => parameter.name)).not.toContain(
      '/handshake/prod/paypal/webhook-id',
    );
    expect(parameters).toContainEqual({
      name: '/handshake/prod/paypal/client-secret',
      type: 'SecureString',
      value: 'client-secret-value',
    });
    expect(parameters).toContainEqual({
      name: '/handshake/prod/limits/daily-token-budget',
      type: 'String',
      value: '2000000',
    });
  });

  it('stores certificate ARNs at their shared paths outside the stage', () => {
    const env = { ...validEnv, CERTIFICATE_ARN_US_EAST_1: usEast1CertificateArn };

    expect(ssmParametersFromEnv(env, 'prod')).toContainEqual({
      name: '/handshake/certificates/us-east-1',
      type: 'String',
      value: usEast1CertificateArn,
    });
  });

  it('rejects a certificate ARN from the wrong region', () => {
    const env = { ...validEnv, CERTIFICATE_ARN_EU_WEST_1: usEast1CertificateArn };

    expect(() => ssmParametersFromEnv(env, 'prod')).toThrow(
      'CERTIFICATE_ARN_EU_WEST_1 must be an ACM certificate ARN in eu-west-1',
    );
  });

  it('refuses to build parameters from an invalid config', () => {
    const env = { ...validEnv, PAYPAL_BASE_URL: 'https://api-m.paypal.com' };

    expect(() => ssmParametersFromEnv(env, 'prod')).toThrow('PAYPAL_BASE_URL is invalid');
  });

  it('rejects a stage name that would escape the SSM path', () => {
    expect(() => ssmParametersFromEnv(validEnv, '../prod')).toThrow(ConfigError);
  });
});
