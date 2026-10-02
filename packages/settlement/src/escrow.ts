import {
  holdsFunds,
  InvalidTransitionError,
  renewAuthorization,
  reviewAuthorization,
  type Deal,
  type DealChange,
} from '@handshake/core';
import { authorizeOrder, PayPalApiError, reauthorizeAuthorization } from '@handshake/paypal';
import { advance } from './progress';
import type { SettlementContext, SettlementResult } from './settle';

/** PayPal answered, but the authorization does not hold the money yet. */
export class AuthorizationNotHeldError extends Error {
  override name = 'AuthorizationNotHeldError';
}

/**
 * Authorizes the buyer-approved order and puts the deal in escrow, but only
 * after policy checks the signed contract against the mandate again. A
 * declined authorization cancels the deal; no money is held.
 */
export async function authorizeEscrow(
  context: SettlementContext,
  deal: Deal,
  orderId: string,
): Promise<SettlementResult> {
  const violations = reviewAuthorization(deal);
  if (violations.length > 0) return { approved: false, violations };

  const start = { deal, events: [] };
  try {
    const { authorization } = await authorizeOrder(context.paypal, {
      dealId: deal.id,
      orderId,
      attempt: deal.eventCount,
    });
    if (authorization.status === 'DENIED') {
      return {
        approved: true,
        ...advance(start, { to: 'CANCELLED' }, context.now(), 'Payment denied'),
      };
    }
    if (authorization.status !== 'CREATED') {
      throw new AuthorizationNotHeldError(
        `Authorization ${authorization.id} is ${authorization.status}`,
      );
    }
    const escrow = {
      orderId,
      authorizationId: authorization.id,
      amount: authorization.amount,
      authorizedAt: authorization.createdAt,
      expiresAt: authorization.expiresAt,
    };
    const inEscrow = advance(
      start,
      { to: 'IN_ESCROW', escrow },
      context.now(),
      'Payment authorized',
    );
    const awaiting = advance(
      inEscrow,
      { to: 'AWAITING_DELIVERY' },
      context.now(),
      'Waiting for delivery',
    );
    return { approved: true, ...awaiting };
  } catch (error) {
    // PayPal refused for good, for example a declined card. Server errors
    // propagate so the caller retries with the same request ID.
    if (error instanceof PayPalApiError && error.statusCode === 422) {
      return {
        approved: true,
        ...advance(start, { to: 'CANCELLED' }, context.now(), error.message),
      };
    }
    throw error;
  }
}

/**
 * Renews the hold after PayPal's honor period so a capture stays possible
 * until the delivery deadline. The new authorization replaces the old one.
 */
export async function renewEscrow(context: SettlementContext, deal: Deal): Promise<DealChange> {
  if (!holdsFunds(deal)) {
    throw new InvalidTransitionError(`Deal ${deal.id} holds no funds in state ${deal.state}`);
  }
  const authorization = await reauthorizeAuthorization(context.paypal, {
    dealId: deal.id,
    authorizationId: deal.escrow.authorizationId,
    attempt: deal.eventCount,
  });
  if (authorization.status !== 'CREATED') {
    throw new AuthorizationNotHeldError(
      `Authorization ${authorization.id} is ${authorization.status}`,
    );
  }
  return renewAuthorization(
    deal,
    {
      authorizationId: authorization.id,
      amount: authorization.amount,
      authorizedAt: authorization.createdAt,
      expiresAt: authorization.expiresAt,
    },
    context.now(),
  );
}
