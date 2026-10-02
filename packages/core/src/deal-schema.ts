import { z } from 'zod';
import { dealTermsSchema, type SignedContract } from './contract';
import { dealStates, type Deal } from './deal';
import { mandateSchema } from './mandate';
import { moneySchema } from './money';

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
