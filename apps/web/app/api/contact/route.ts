import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleFormSubmission, respondWithAttemptStatus } from '../../_forms/form-route';

export const dynamic = 'force-dynamic';

const contactForm = {
  name: 'contact',
  schema: z.object({
    name: z.string().trim().min(1).max(200),
    email: z.email().max(320),
    company: z.string().trim().max(200).optional(),
    message: z.string().trim().min(1).max(2000),
    areTermsAccepted: z.literal(true),
  }),
  invalidMessage: 'Fill in every required field.',
  failureMessage: 'We could not send your message. Try again later.',
} as const;

export function GET(req: NextRequest) {
  return respondWithAttemptStatus(req, 'contact');
}

export function POST(req: NextRequest) {
  return handleFormSubmission(req, contactForm);
}
