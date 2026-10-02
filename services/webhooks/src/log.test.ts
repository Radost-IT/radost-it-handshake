import { afterEach, describe, expect, it, vi } from 'vitest';
import { log } from './log';

describe('log', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes one JSON line and redacts secret-looking keys', () => {
    const write = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    log.error('PayPal call failed', { debugId: 'debug-1', accessToken: 'abc', email: 'a@b.c' });

    expect(write).toHaveBeenCalledOnce();
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toEqual({
      level: 'error',
      message: 'PayPal call failed',
      debugId: 'debug-1',
      accessToken: '[redacted]',
      email: '[redacted]',
    });
  });
});
