import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { describe, expect, it, vi } from 'vitest';
import { loadDailyTokenBudget } from './daily-token-budget';

function ssmClientReturning(value: string | undefined) {
  const client = new SSMClient({});
  const send = vi.spyOn(client, 'send').mockResolvedValue({ Parameter: { Value: value } } as never);
  return { client, send };
}

describe('loadDailyTokenBudget', () => {
  it('reads the budget from the environment when no stage is set', async () => {
    await expect(loadDailyTokenBudget({ DAILY_TOKEN_BUDGET: '2000000' })).resolves.toBe(2_000_000);
  });

  it.each(['0', '-5', '1.5', 'many'])('rejects a budget of "%s"', async (value) => {
    await expect(loadDailyTokenBudget({ DAILY_TOKEN_BUDGET: value })).rejects.toThrow(
      'Invalid configuration: DAILY_TOKEN_BUDGET must be a positive whole number',
    );
  });

  it('names the missing variable', async () => {
    await expect(loadDailyTokenBudget({})).rejects.toThrow(
      'Invalid configuration: DAILY_TOKEN_BUDGET is missing',
    );
  });

  it('reads only its own parameter from SSM on AWS', async () => {
    const { client, send } = ssmClientReturning('500000');

    await expect(loadDailyTokenBudget({ HANDSHAKE_STAGE: 'prod' }, client)).resolves.toBe(500_000);

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(GetParameterCommand);
    expect(command?.input).toEqual({
      Name: '/handshake/prod/limits/daily-token-budget',
      WithDecryption: true,
    });
  });
});
