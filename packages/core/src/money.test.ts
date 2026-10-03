import { describe, expect, it } from 'vitest';
import {
  addMoney,
  compareMoney,
  CurrencyMismatchError,
  formatMoney,
  InvalidMoneyError,
  money,
  moneyEquals,
  moneyFromNumber,
  moneySchema,
  percentOfMoney,
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

  it('adds amounts exactly', () => {
    expect(addMoney(money('0.10', 'USD'), money('0.20', 'USD'))).toEqual(money('0.30', 'USD'));
    expect(addMoney(money('999', 'JPY'), money('1', 'JPY'))).toEqual(money('1000', 'JPY'));
    expect(() => addMoney(money('1', 'USD'), money('1', 'EUR'))).toThrow(CurrencyMismatchError);
  });

  it('builds money from an exact JSON number', () => {
    expect(moneyFromNumber(19.99, 'USD')).toEqual(money('19.99', 'USD'));
    expect(moneyFromNumber(20, 'USD')).toEqual(money('20.00', 'USD'));
    expect(moneyFromNumber(1500, 'JPY')).toEqual(money('1500', 'JPY'));
  });

  it('refuses numbers that would need rounding, negatives and non-finite values', () => {
    expect(() => moneyFromNumber(19.999, 'USD')).toThrow(InvalidMoneyError);
    expect(() => moneyFromNumber(1500.5, 'JPY')).toThrow(InvalidMoneyError);
    expect(() => moneyFromNumber(-1, 'USD')).toThrow(InvalidMoneyError);
    expect(() => moneyFromNumber(Number.NaN, 'USD')).toThrow(InvalidMoneyError);
  });

  it('takes a percent of an amount, rounding down to the smallest unit', () => {
    expect(percentOfMoney(money('5.00', 'USD'), 35)).toEqual(money('1.75', 'USD'));
    expect(percentOfMoney(money('0.99', 'USD'), 50)).toEqual(money('0.49', 'USD'));
    expect(percentOfMoney(money('999', 'JPY'), 10)).toEqual(money('99', 'JPY'));
  });

  it('refuses percents outside 0 to 100 or with decimals', () => {
    expect(() => percentOfMoney(money('5.00', 'USD'), 101)).toThrow(InvalidMoneyError);
    expect(() => percentOfMoney(money('5.00', 'USD'), 12.5)).toThrow(InvalidMoneyError);
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
