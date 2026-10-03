import { describe, expect, it } from 'vitest';
import { hasValidSignature, signFormValue } from './signature';

const SECRET = 'a'.repeat(64);

describe('form signatures', () => {
  it('accepts a value signed with the same secret', () => {
    expect(hasValidSignature(SECRET, '3.1700', signFormValue(SECRET, '3.1700'))).toBe(true);
  });

  it('rejects a changed value', () => {
    expect(hasValidSignature(SECRET, '0.1700', signFormValue(SECRET, '3.1700'))).toBe(false);
  });

  it('rejects a signature of the wrong length', () => {
    expect(hasValidSignature(SECRET, '3.1700', 'abc')).toBe(false);
  });
});
