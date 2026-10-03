import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { describe, expect, it, vi } from 'vitest';
import { loadArenaMailConfig } from './arena-mail';

const env = {
  ARENA_EMAIL_FROM: 'arena@example.com',
  ARENA_ADMIN_EMAIL: 'admin@example.com',
  ZEPTOMAIL_API_URL: 'https://api.zeptomail.eu',
  ZEPTOMAIL_TOKEN: 'Zoho-enczapikey test-token',
};

describe('loadArenaMailConfig', () => {
  it('reads the addresses and the ZeptoMail account from the environment when no stage is set', async () => {
    await expect(loadArenaMailConfig(env)).resolves.toEqual({
      from: 'arena@example.com',
      adminEmail: 'admin@example.com',
      zeptoMail: { apiUrl: 'https://api.zeptomail.eu', token: 'Zoho-enczapikey test-token' },
    });
  });

  it('names a missing address', async () => {
    await expect(loadArenaMailConfig({ ...env, ARENA_ADMIN_EMAIL: '' })).rejects.toThrow(
      'Invalid configuration: ARENA_ADMIN_EMAIL is missing',
    );
  });

  it('rejects a value that is not an email address', async () => {
    await expect(loadArenaMailConfig({ ...env, ARENA_EMAIL_FROM: 'arena' })).rejects.toThrow(
      'Invalid configuration: ARENA_EMAIL_FROM must be an email address',
    );
  });

  it('rejects a token without the Zoho-enczapikey prefix and never shows the token', async () => {
    const error: unknown = await loadArenaMailConfig({
      ...env,
      ZEPTOMAIL_TOKEN: 'secret-value',
    }).catch((caught: unknown) => caught);
    expect(String(error)).toContain('ZEPTOMAIL_TOKEN must be a ZeptoMail Send Mail token');
    expect(String(error)).not.toContain('secret-value');
  });

  it('reads only its own parameters from SSM on AWS', async () => {
    const client = new SSMClient({});
    const parameter = (value: string) => ({ Parameter: { Value: value } }) as never;
    // Promise.all starts the reads in this order.
    const send = vi
      .spyOn(client, 'send')
      .mockResolvedValueOnce(parameter('arena@example.com'))
      .mockResolvedValueOnce(parameter('admin@example.com'))
      .mockResolvedValueOnce(parameter('https://api.zeptomail.eu'))
      .mockResolvedValueOnce(parameter('Zoho-enczapikey test-token'));

    await loadArenaMailConfig({ HANDSHAKE_STAGE: 'prod' }, client);

    const names = send.mock.calls.map(([command]) => {
      expect(command).toBeInstanceOf(GetParameterCommand);
      return (command as GetParameterCommand).input.Name;
    });
    expect(names).toEqual([
      '/handshake/prod/arena/email-from',
      '/handshake/prod/arena/admin-email',
      '/handshake/prod/arena/zeptomail-api-url',
      '/handshake/prod/arena/zeptomail-token',
    ]);
  });
});
