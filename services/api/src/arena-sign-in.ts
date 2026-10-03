import { signInCodeEmail, sendEmail } from '@handshake/mail';
import {
  accountIdForEmail,
  checkSignInCode,
  closeSession,
  openSession,
  saveSignInCode,
  takeRateLimitSlot,
  upsertAccount,
} from '@handshake/store';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { hashToken, json, parseJson } from './http';
import {
  expiredSessionCookie,
  readSessionToken,
  SESSION_DAYS,
  sessionCookie,
  type ArenaApiContext,
} from './arena-session';

const CODE_VALID_MINUTES = 10;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
// Five codes per email per hour, each locked after five wrong tries, leave a
// guesser 25 tries an hour against a million codes. The IP limit stops one
// network from mailing many addresses.
const CODES_PER_EMAIL_PER_HOUR = 5;
const CODES_PER_IP_PER_HOUR = 20;

const emailSchema = z
  .string()
  .trim()
  .max(254)
  .transform((email) => email.toLowerCase())
  .pipe(z.email());

// Salting with the account stops one hash table of all six-digit codes from working on every account.
const hashSignInCode = (accountId: string, code: string) => hashToken(`${accountId}:${code}`);

const signInBodySchema = z.object({ email: emailSchema });

export interface SignInRequest {
  body: string;
  sourceIp: string;
}

/**
 * Emails a sign-in code. It answers 202 whether or not the email has an
 * account, so the answer does not tell who has signed up.
 */
export async function requestSignInCode(
  context: ArenaApiContext,
  request: SignInRequest,
): Promise<APIGatewayProxyStructuredResultV2> {
  const parsed = signInBodySchema.safeParse(parseJson(request.body));
  if (!parsed.success) return json(400, { error: 'Enter a valid email address' });
  const { email } = parsed.data;
  const accountId = accountIdForEmail(email);

  const now = context.now();
  const hour = now.toISOString().slice(0, 13);
  const expiresAt = new Date(Date.parse(`${hour}:00:00Z`) + 2 * HOUR_MS);
  const [emailAllowed, ipAllowed] = await Promise.all([
    takeRateLimitSlot(context.table, {
      subject: `signin-email#${accountId}`,
      window: hour,
      limit: CODES_PER_EMAIL_PER_HOUR,
      expiresAt,
    }),
    takeRateLimitSlot(context.table, {
      subject: `signin-ip#${hashToken(request.sourceIp)}`,
      window: hour,
      limit: CODES_PER_IP_PER_HOUR,
      expiresAt,
    }),
  ]);
  if (!emailAllowed || !ipAllowed) {
    return json(429, { error: 'Too many sign-in codes. Try again next hour' });
  }

  const code = context.newSignInCode();
  await saveSignInCode(context.table, {
    accountId,
    codeHash: hashSignInCode(accountId, code),
    expiresAt: new Date(now.getTime() + CODE_VALID_MINUTES * MINUTE_MS),
  });
  await sendEmail(context.mail.client, {
    from: context.mail.from,
    to: email,
    ...signInCodeEmail(code, CODE_VALID_MINUTES),
  });
  return json(202, { sent: true });
}

const verifyBodySchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});

const codeErrors = {
  wrong: 'This code is wrong',
  expired: 'This code has expired. Ask for a new one',
  locked: 'Too many wrong codes. Ask for a new one',
} as const;

/** Checks the emailed code, creates the account on the first sign-in and opens a session. */
export async function verifySignInCode(
  context: ArenaApiContext,
  body: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const parsed = verifyBodySchema.safeParse(parseJson(body));
  if (!parsed.success) return json(400, { error: 'Send your email and the six-digit code' });
  const { email, code } = parsed.data;
  const accountId = accountIdForEmail(email);
  const now = context.now();

  const check = await checkSignInCode(context.table, {
    accountId,
    codeHash: hashSignInCode(accountId, code),
    now,
  });
  if (check !== 'valid') return json(400, { error: codeErrors[check] });

  const token = context.newSessionToken();
  const [account] = await Promise.all([
    upsertAccount(context.table, { accountId, email, signedInAt: now }),
    openSession(context.table, {
      tokenHash: hashToken(token),
      accountId,
      expiresAt: new Date(now.getTime() + SESSION_DAYS * 24 * HOUR_MS),
    }),
  ]);
  return { ...json(200, { access: account.access }), cookies: [sessionCookie(token)] };
}

export async function signOut(
  context: ArenaApiContext,
  cookies: readonly string[],
): Promise<APIGatewayProxyStructuredResultV2> {
  const token = readSessionToken(cookies);
  if (token) await closeSession(context.table, hashToken(token));
  return { statusCode: 204, cookies: [expiredSessionCookie] };
}
