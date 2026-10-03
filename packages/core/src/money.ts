import { z } from 'zod';

// Decimal places per ISO 4217 code, as PayPal expects them in `value`.
const currencyExponents = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  JPY: 0,
} as const;

export type CurrencyCode = keyof typeof currencyExponents;

export const currencyCodes = Object.keys(currencyExponents) as [CurrencyCode, ...CurrencyCode[]];

/** A non-negative amount in PayPal format: `value` always has the currency's exact decimals. */
export interface Money {
  currency: CurrencyCode;
  value: string;
}

export class InvalidMoneyError extends Error {
  override name = 'InvalidMoneyError';
}

export class CurrencyMismatchError extends Error {
  override name = 'CurrencyMismatchError';
}

function amountPattern(currency: CurrencyCode): RegExp {
  const exponent = currencyExponents[currency];
  return exponent === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${exponent}})?$`);
}

/**
 * Builds a Money value from a decimal string such as "12.5", normalized to
 * "12.50" for USD. Throws `InvalidMoneyError` for negatives, floats in
 * scientific notation, or more decimals than the currency allows.
 */
export function money(value: string, currency: CurrencyCode): Money {
  if (!amountPattern(currency).test(value)) {
    throw new InvalidMoneyError(`Invalid ${currency} amount`);
  }
  return fromMinorUnits(toMinorUnits({ currency, value }), currency);
}

export const moneySchema = z
  .object({ currency: z.enum(currencyCodes), value: z.string() })
  .refine((candidate) => amountPattern(candidate.currency).test(candidate.value), {
    message: 'Amount must be a non-negative decimal string with the currency’s decimals',
    path: ['value'],
  })
  .transform((candidate) => money(candidate.value, candidate.currency));

function toMinorUnits(amount: Money): bigint {
  const exponent = currencyExponents[amount.currency];
  const [whole = '0', fraction = ''] = amount.value.split('.');
  return BigInt(whole + fraction.padEnd(exponent, '0'));
}

function fromMinorUnits(minor: bigint, currency: CurrencyCode): Money {
  const exponent = currencyExponents[currency];
  if (exponent === 0) return { currency, value: minor.toString() };
  const digits = minor.toString().padStart(exponent + 1, '0');
  return {
    currency,
    value: `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`,
  };
}

export function hasSameCurrency(a: Money, b: Money): boolean {
  return a.currency === b.currency;
}

/** Returns -1, 0, or 1. Throws `CurrencyMismatchError` when currencies differ. */
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  if (!hasSameCurrency(a, b)) {
    throw new CurrencyMismatchError(`Cannot compare ${a.currency} with ${b.currency}`);
  }
  const difference = toMinorUnits(a) - toMinorUnits(b);
  if (difference === 0n) return 0;
  return difference < 0n ? -1 : 1;
}

/** Throws `CurrencyMismatchError` when currencies differ. */
export function addMoney(a: Money, b: Money): Money {
  if (!hasSameCurrency(a, b)) {
    throw new CurrencyMismatchError(`Cannot add ${a.currency} to ${b.currency}`);
  }
  return fromMinorUnits(toMinorUnits(a) + toMinorUnits(b), a.currency);
}

/**
 * Returns `percent` of `amount`, rounded down to the currency's smallest unit
 * so a share never pays more than its cap. `percent` is a whole number from 0 to 100.
 */
export function percentOfMoney(amount: Money, percent: number): Money {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new InvalidMoneyError(
      `Percent must be a whole number from 0 to 100, got ${String(percent)}`,
    );
  }
  return fromMinorUnits((toMinorUnits(amount) * BigInt(percent)) / 100n, amount.currency);
}

export function moneyEquals(a: Money, b: Money): boolean {
  return hasSameCurrency(a, b) && compareMoney(a, b) === 0;
}

export function formatMoney(amount: Money): string {
  return `${amount.value} ${amount.currency}`;
}
