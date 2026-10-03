import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { describe, expect, it, vi } from 'vitest';
import { loadArenaMailConfig } from './arena-mail';

const env = { ARENA_EMAIL_FROM: 'arena@example.com', ARENA_ADMIN_EMAIL: 'admin@example.com' };

describe('loadArenaMailConfig', () => {
  it('reads both addresses from the environment when no stage is set', async () => {
    await expect(loadArenaMailConfig(env)).resolves.toEqual({
      from: 'arena@example.com',
      adminEmail: 'admin@example.com',
    });
  });

  it('names a missing address', async () => {
    await expect(loadArenaMailConfig({ ARENA_EMAIL_FROM: 'arena@example.com' })).rejects.toThrow(
      'Invalid configuration: ARENA_ADMIN_EMAIL is missing',
    );
  });

  it('rejects a value that is not an email address', async () => {
    await expect(loadArenaMailConfig({ ...env, ARENA_EMAIL_FROM: 'arena' })).rejects.toThrow(
      'Invalid configuration: ARENA_EMAIL_FROM must be an email address',
    );
  });

  it('reads only its own parameters from SSM on AWS', async () => {
    const client = new SSMClient({});
    const send = vi
      .spyOn(client, 'send')
      .mockResolvedValue({ Parameter: { Value: 'someone@example.com' } } as never);

    await loadArenaMailConfig({ HANDSHAKE_STAGE: 'prod' }, client);

    const names = send.mock.calls.map(([command]) => {
      expect(command).toBeInstanceOf(GetParameterCommand);
      return (command as GetParameterCommand).input.Name;
    });
    expect(names).toEqual([
      '/handshake/prod/arena/email-from',
      '/handshake/prod/arena/admin-email',
    ]);
  });
});
