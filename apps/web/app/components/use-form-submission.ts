'use client';

import { useCallback, useState } from 'react';
import { z } from 'zod';

const formResponseSchema = z.object({
  success: z.boolean().optional(),
  error: z.string().optional(),
  blocked: z.boolean().optional(),
  retryAfterMinutes: z.number().optional(),
});

export type FormStatus =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'failed'; error: string }
  | { kind: 'locked'; minutes: number };

const GENERIC_ERROR = 'Something went wrong. Try again.';

async function readFormResponse(response: Response) {
  const parsed = formResponseSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data : {};
}

/** Posts a form to its API route and tracks the attempt lock the route keeps in a cookie. */
export function useFormSubmission(endpoint: string) {
  const [status, setStatus] = useState<FormStatus>({ kind: 'idle' });
  // The server counts every attempt and a used challenge cannot be retried, so
  // forms key their challenge on this to fetch a fresh sum.
  const [attempts, setAttempts] = useState(0);

  // The lock lives in an httpOnly cookie, so only the server can say whether it is still on.
  const checkLock = useCallback(async () => {
    const body = await readFormResponse(await fetch(endpoint, { cache: 'no-store' }));
    if (body.blocked) setStatus({ kind: 'locked', minutes: body.retryAfterMinutes ?? 60 });
  }, [endpoint]);

  const submit = async (fields: Record<string, unknown>) => {
    setStatus({ kind: 'sending' });
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(fields),
      });
      const body = await readFormResponse(response);
      if (response.ok && body.success) setStatus({ kind: 'sent' });
      else if (body.blocked) setStatus({ kind: 'locked', minutes: body.retryAfterMinutes ?? 60 });
      else setStatus({ kind: 'failed', error: body.error ?? GENERIC_ERROR });
    } catch {
      setStatus({ kind: 'failed', error: GENERIC_ERROR });
    }
    setAttempts((count) => count + 1);
  };

  return { status, attempts, submit, checkLock };
}
