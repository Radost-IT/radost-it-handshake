import { z } from 'zod';
import { dealTermsSchema, type SignedContract } from './contract';
import { dealStates, type Deal, type DealEvent } from './deal';
import { mandateSchema } from './mandate';
import { moneySchema } from './money';
import type { NegotiationMove, NegotiationTurn } from './negotiation';

const timestamp = z.iso.datetime({ offset: true });

const signedContractSchema: z.ZodType<SignedContract> = z.object({
  terms: dealTermsSchema,
  signatures: z.array(
    z.object({
      party: z.enum(['buyer', 'seller']),
      signerId: z.string().min(1),
      digest: z.string().min(1),
      signedAt: timestamp,
    }),
  ),
});

/** Parses a stored deal. Stored data is checked like any other input. */
export const dealSchema: z.ZodType<Deal> = z.object({
  id: z.string().min(1),
  state: z.enum(dealStates),
  mandate: mandateSchema,
  contract: signedContractSchema.nullable(),
  escrow: z
    .object({
      orderId: z.string().min(1),
      authorizationId: z.string().min(1),
      amount: moneySchema,
      authorizedAt: timestamp,
      expiresAt: timestamp,
    })
    .nullable(),
  capture: z
    .object({ captureId: z.string().min(1), status: z.literal('COMPLETED'), amount: moneySchema })
    .nullable(),
  eventCount: z.number().int().nonnegative(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const eventBase = { dealId: z.string().min(1), seq: z.number().int().nonnegative(), at: timestamp };

/** Parses a stored deal event. */
export const dealEventSchema: z.ZodType<DealEvent> = z.discriminatedUnion('type', [
  z.object({ ...eventBase, type: z.literal('CREATED') }),
  z.object({
    ...eventBase,
    type: z.literal('STATE_CHANGED'),
    from: z.enum(dealStates),
    to: z.enum(dealStates),
    reason: z.string(),
  }),
  z.object({
    ...eventBase,
    type: z.literal('AUTHORIZATION_RENEWED'),
    authorizationId: z.string().min(1),
    expiresAt: timestamp,
  }),
]);

const negotiationMoveSchema: z.ZodType<NegotiationMove> = z.discriminatedUnion('action', [
  z.object({ action: z.literal('OFFER'), price: moneySchema, message: z.string() }),
  z.object({ action: z.literal('ACCEPT'), message: z.string() }),
  z.object({ action: z.literal('WALK_AWAY'), message: z.string() }),
]);

/** Parses a stored negotiation turn. */
export const negotiationTurnSchema: z.ZodType<NegotiationTurn> = z.object({
  party: z.enum(['buyer', 'seller']),
  move: negotiationMoveSchema,
  at: timestamp,
});
