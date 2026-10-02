import { describe, expect, it } from 'vitest';
import {
  compareMoney,
  CurrencyMismatchError,
  formatMoney,
  InvalidMoneyError,
  money,
  moneyEquals,
  moneySchema,
} from './money';

describe('money', () => {
  it.each([
    ['12', 'USD', '12.00'],
    ['12.5', 'USD', '12.50'],
    ['0.01', 'EUR', '0.01'],
    ['007.10', 'GBP', '7.10'],
    ['1500', 'JPY', '1500'],
  ] as const)('normalizes %s %s to %s', (value, currency, expected) => {
    expect(money(value, currency)).toEqual({ currency, value: expected });
  });

  it.each([
    ['-1', 'USD'],
    ['1.234', 'USD'],
    ['1e3', 'USD'],
    ['1.5', 'JPY'],
    ['', 'USD'],
    ['.5', 'USD'],
    ['1,00', 'EUR'],
  ] as const)('rejects %s %s', (value, currency) => {
    expect(() => money(value, currency)).toThrow(InvalidMoneyError);
  });

  it('compares amounts exactly, without floating point drift', () => {
    const sum = money('0.30', 'USD');
    expect(compareMoney(money('0.3', 'USD'), sum)).toBe(0);
    expect(compareMoney(money('99999999999999.99', 'USD'), money('99999999999999.98', 'USD'))).toBe(
      1,
    );
    expect(compareMoney(money('9.99', 'USD'), money('10', 'USD'))).toBe(-1);
  });

  it('refuses to compare different currencies', () => {
    expect(() => compareMoney(money('1', 'USD'), money('1', 'EUR'))).toThrow(CurrencyMismatchError);
  });

  it('treats different currencies as unequal', () => {
    expect(moneyEquals(money('1', 'USD'), money('1', 'EUR'))).toBe(false);
    expect(moneyEquals(money('1', 'USD'), money('1.00', 'USD'))).toBe(true);
  });

  it('formats for logs and messages', () => {
    expect(formatMoney(money('5', 'USD'))).toBe('5.00 USD');
  });
});

describe('moneySchema', () => {
  it('parses and normalizes untrusted input', () => {
    expect(moneySchema.parse({ currency: 'USD', value: '3.5' })).toEqual({
      currency: 'USD',
      value: '3.50',
    });
  });

  it('rejects numbers, unknown currencies, and bad amounts', () => {
    expect(moneySchema.safeParse({ currency: 'USD', value: 3.5 }).success).toBe(false);
    expect(moneySchema.safeParse({ currency: 'BTC', value: '1' }).success).toBe(false);
    expect(moneySchema.safeParse({ currency: 'USD', value: '3.555' }).success).toBe(false);
  });
});
