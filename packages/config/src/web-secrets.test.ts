import { GetParameterCommand, ParameterNotFound, SSMClient } from '@aws-sdk/client-ssm';
import { describe, expect, it, vi } from 'vitest';
import { loadFormSigningSecret } from './form-signing-secret';
import { ConfigError } from './parse';

const secret = 'a'.repeat(64);

function ssmClientReturning(value: string | undefined) {
  const client = new SSMClient({});
  const send = vi.spyOn(client, 'send').mockResolvedValue({ Parameter: { Value: value } } as never);
  return { client, send };
}

describe('loadFormSigningSecret', () => {
  it('reads the secret from the environment when no stage is set', async () => {
    await expect(loadFormSigningSecret({ FORM_SIGNING_SECRET: secret })).resolves.toBe(secret);
  });

  it('names the missing variable without a value', async () => {
    await expect(loadFormSigningSecret({})).rejects.toThrow(
      new ConfigError('Invalid configuration: FORM_SIGNING_SECRET is missing'),
    );
  });

  it('rejects a secret that is not 32 bytes of hex', async () => {
    await expect(loadFormSigningSecret({ FORM_SIGNING_SECRET: 'short' })).rejects.toThrow(
      'FORM_SIGNING_SECRET must be 64 hex characters',
    );
  });

  it('reads only its own decrypted parameter from SSM on AWS', async () => {
    const { client, send } = ssmClientReturning(secret);

    await expect(loadFormSigningSecret({ HANDSHAKE_STAGE: 'prod' }, client)).resolves.toBe(secret);

    expect(send).toHaveBeenCalledOnce();
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(GetParameterCommand);
    expect(command?.input).toEqual({
      Name: '/handshake/prod/web/form-signing-secret',
      WithDecryption: true,
    });
  });

  it('names the SSM parameter when it is empty', async () => {
    const { client } = ssmClientReturning(undefined);

    await expect(loadFormSigningSecret({ HANDSHAKE_STAGE: 'prod' }, client)).rejects.toThrow(
      'SSM parameter /handshake/prod/web/form-signing-secret is missing',
    );
  });

  it('lets a missing parameter error from SSM propagate', async () => {
    const client = new SSMClient({});
    vi.spyOn(client, 'send').mockRejectedValue(
      new ParameterNotFound({ message: 'not found', $metadata: {} }),
    );

    await expect(loadFormSigningSecret({ HANDSHAKE_STAGE: 'prod' }, client)).rejects.toThrow(
      ParameterNotFound,
    );
  });
});
