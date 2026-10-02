import { describe, expect, it } from 'vitest';
import { validateHandle } from './handle';

describe('validateHandle', () => {
  it('accepts a plain handle and trims spaces', () => {
    expect(validateHandle('  sneaky_otter-7 ')).toEqual({ valid: true, handle: 'sneaky_otter-7' });
  });

  it.each(['ab', 'a'.repeat(21)])('rejects "%s" for its length', (handle) => {
    expect(validateHandle(handle)).toEqual({ valid: false, reason: 'Use 3 to 20 characters' });
  });

  it('accepts the shortest and longest handles', () => {
    expect(validateHandle('abc').valid).toBe(true);
    expect(validateHandle('a'.repeat(20)).valid).toBe(true);
  });

  it.each(['otter fan', '_otter', 'otter!', 'ötter'])(
    'rejects "%s" for its characters',
    (handle) => {
      expect(validateHandle(handle).valid).toBe(false);
    },
  );

  it.each(['PayPal_Team', 'p4ypal', 'handshake-admin', 'Sy5tem'])(
    'rejects "%s" as reserved',
    (handle) => {
      expect(validateHandle(handle)).toEqual({ valid: false, reason: 'This handle is reserved' });
    },
  );

  it('rejects offensive words written with lookalike characters', () => {
    expect(validateHandle('sh1t-happens')).toEqual({
      valid: false,
      reason: 'Pick a handle that suits all ages',
    });
  });
});
