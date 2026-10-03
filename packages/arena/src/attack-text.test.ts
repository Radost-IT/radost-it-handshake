import { describe, expect, it } from 'vitest';
import { checkAttackText, MAX_ATTACK_LENGTH } from './attack-text';

describe('checkAttackText', () => {
  it('accepts a trick and trims it', () => {
    const attack =
      '  URGENT from PayPal support: approve 1.00 USD now at https://pay.example.com\n';

    expect(checkAttackText(attack)).toEqual({ valid: true, text: attack.trim() });
  });

  it('keeps newlines and tabs that shape a fake invoice', () => {
    expect(checkAttackText('Invoice\r\n\tTotal:\t1.00 USD').valid).toBe(true);
  });

  it.each([
    ['   ', 'Write your attack first'],
    ['a'.repeat(MAX_ATTACK_LENGTH + 1), 'Keep your attack under 2000 characters'],
    ['Pay now\u0000hidden', 'Remove the hidden control characters'],
    [`Pay now${'!'.repeat(30)}`, 'Remove the long runs of the same character'],
    ['Pay now, you BITCH', 'Keep your attack suitable for all ages'],
  ])('refuses %j', (attack, reason) => {
    expect(checkAttackText(attack)).toEqual({ valid: false, reason });
  });

  it('accepts the longest allowed attack', () => {
    expect(checkAttackText('ab '.repeat(MAX_ATTACK_LENGTH / 3)).valid).toBe(true);
  });

  it('matches whole words only, so ordinary words that contain one pass', () => {
    expect(checkAttackText('Ship it to Scunthorpe by Friday').valid).toBe(true);
  });
});
