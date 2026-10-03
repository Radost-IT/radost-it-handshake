import type { PayPalOperation } from './errors';

export type MutatingOperation = Exclude<PayPalOperation, 'get-order' | 'verify-webhook'>;

/**
 * The PayPal-Request-Id for one money operation on a deal, or on an arena
 * attempt for a payout. The same ID, operation and attempt always give the same key, so a retried request returns
 * PayPal's first result. Increase `attempt` only to start a new operation on
 * purpose, for example a second reauthorization.
 */
export function paypalRequestId(
  dealId: string,
  operation: MutatingOperation,
  attempt: number,
): string {
  if (dealId.length === 0) throw new RangeError('dealId must not be empty');
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new RangeError('attempt must be a non-negative integer');
  }
  return `${dealId}:${operation}:${attempt}`;
}
