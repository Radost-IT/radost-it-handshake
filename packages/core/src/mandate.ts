import { z } from 'zod';
import { hasSameCurrency, moneySchema } from './money';

export const mandateSchema = z
  .object({
    maxPrice: moneySchema,
    blockedCategories: z.array(z.string().trim().min(1).max(100)).max(50),
    // Deals priced at or above this amount wait for a person to approve them.
    humanApprovalThreshold: moneySchema,
  })
  .refine((mandate) => hasSameCurrency(mandate.maxPrice, mandate.humanApprovalThreshold), {
    message: 'Max price and approval threshold must use the same currency',
    path: ['humanApprovalThreshold'],
  });

export type Mandate = z.infer<typeof mandateSchema>;
