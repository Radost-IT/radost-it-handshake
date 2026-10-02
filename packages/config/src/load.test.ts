import { GetParametersByPathCommand, SSMClient } from '@aws-sdk/client-ssm';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig, readConfigFromSsm } from './load';
import { ConfigError } from './parse';

const validEnv = {
  PAYPAL_CLIENT_ID: 'client-id',
  PAYPAL_CLIENT_SECRET: 'client-secret-value',
  PAYPAL_BASE_URL: 'https://api-m.sandbox.paypal.com',
  CHANNEL3_API_KEY: 'channel3-key-value',
  BEDROCK_REGION: 'eu-west-1',
  BEDROCK_MODEL_FAST: 'eu.fast-model',
  BEDROCK_MODEL_SMART: 'eu.smart-model',
  DAILY_TOKEN_BUDGET: '2000000',
  NEGOTIATION_MAX_TURNS: '8',
};

describe('loadConfig from environment variables', () => {
  it('returns typed config for a complete environment', async () => {
    const config = await loadConfig({ ...validEnv, PAYPAL_WEBHOOK_ID: 'WH-1' });

    expect(config.paypal.baseUrl).toBe('https://api-m.sandbox.paypal.com');
    expect(config.paypal.webhookId).toBe('WH-1');
    expect(config.limits).toEqual({ dailyTokenBudget: 2_000_000, negotiationMaxTurns: 8 });
  });

  it('allows the webhook ID to be absent before the webhook is registered', async () => {
    const config = await loadConfig(validEnv);

    expect(config.paypal.webhookId).toBeUndefined();
  });

  it('names every missing key and treats empty values as missing', async () => {
    const env = { ...validEnv, PAYPAL_CLIENT_SECRET: '', CHANNEL3_API_KEY: undefined };

    await expect(loadConfig(env)).rejects.toThrow(
      'Invalid configuration: PAYPAL_CLIENT_SECRET is missing; CHANNEL3_API_KEY is missing',
    );
  });

  it('rejects any PayPal base URL other than the sandbox', async () => {
    const env = { ...validEnv, PAYPAL_BASE_URL: 'https://api-m.paypal.com' };

    await expect(loadConfig(env)).rejects.toThrow('PAYPAL_BASE_URL is invalid');
  });

  it('never includes values in the error message', async () => {
    const env = { ...validEnv, DAILY_TOKEN_BUDGET: 'secret-looking-value' };

    const error = await loadConfig(env).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConfigError);
    expect((error as Error).message).toBe('Invalid configuration: DAILY_TOKEN_BUDGET is invalid');
    expect((error as Error).message).not.toContain('secret-looking-value');
  });

  it('rejects a stage name that would escape the SSM path', async () => {
    await expect(loadConfig({ HANDSHAKE_STAGE: '../prod' })).rejects.toThrow(ConfigError);
  });
});

describe('readConfigFromSsm', () => {
  it('maps parameters across pages and ignores unknown names', async () => {
    const client = new SSMClient({ region: 'eu-west-1' });
    const send = vi
      .spyOn(client, 'send')
      .mockResolvedValueOnce({
        Parameters: [
          { Name: '/handshake/dev/paypal/client-id', Value: 'client-id' },
          { Name: '/handshake/dev/unrelated', Value: 'ignored' },
        ],
        NextToken: 'page-2',
      } as never)
      .mockResolvedValueOnce({
        Parameters: [{ Name: '/handshake/dev/limits/negotiation-max-turns', Value: '8' }],
      } as never);

    const raw = await readConfigFromSsm(client, '/handshake/dev');

    expect(raw).toEqual({ paypalClientId: 'client-id', negotiationMaxTurns: '8' });
    expect(send).toHaveBeenCalledTimes(2);
    const firstCommand = send.mock.calls[0]?.[0] as GetParametersByPathCommand;
    expect(firstCommand.input).toMatchObject({
      Path: '/handshake/dev',
      Recursive: true,
      WithDecryption: true,
    });
  });
});
