import { GetParameterCommand, ParameterNotFound, SSMClient } from '@aws-sdk/client-ssm';
import { describe, expect, it, vi } from 'vitest';
import { loadFormSigningSecret, loadOriginVerifySecret } from './web-secrets';
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

describe('loadOriginVerifySecret', () => {
  it('returns null locally, where no CloudFront sends the header', async () => {
    await expect(loadOriginVerifySecret({})).resolves.toBeNull();
  });

  it('reads only its own parameter from SSM on AWS', async () => {
    const { client, send } = ssmClientReturning(secret);

    await expect(loadOriginVerifySecret({ HANDSHAKE_STAGE: 'prod' }, client)).resolves.toBe(secret);

    expect(send.mock.calls[0]?.[0]?.input).toEqual({
      Name: '/handshake/prod/web/origin-verify-secret',
      WithDecryption: true,
    });
  });

  it('rejects a value that is not 32 bytes of hex', async () => {
    const { client } = ssmClientReturning('short');

    await expect(loadOriginVerifySecret({ HANDSHAKE_STAGE: 'prod' }, client)).rejects.toThrow(
      'SSM parameter /handshake/prod/web/origin-verify-secret must be 64 hex characters',
    );
  });
});
