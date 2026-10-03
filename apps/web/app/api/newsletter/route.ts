import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleFormSubmission, respondWithAttemptStatus } from '../../_forms/form-route';

export const dynamic = 'force-dynamic';

const newsletterForm = {
  name: 'newsletter',
  schema: z
    .object({ email: z.email().max(320), areTermsAccepted: z.literal(true) })
    .transform((fields) => ({ ...fields, subscribed: true })),
  invalidMessage: 'Enter a valid email address.',
  failureMessage: 'We could not subscribe you. Try again later.',
} as const;

export function GET(req: NextRequest) {
  return respondWithAttemptStatus(req, 'newsletter');
}

export function POST(req: NextRequest) {
  return handleFormSubmission(req, newsletterForm);
}
