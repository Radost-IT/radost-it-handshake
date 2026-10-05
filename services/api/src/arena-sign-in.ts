import { signInCodeEmail, sendEmail } from '@handshake/mail';
import {
  accountIdForEmail,
  checkSignInCode,
  closeSession,
  getAccount,
  hashSignInCode,
  openSession,
  saveSignInCode,
  takeRateLimitSlot,
  upsertAccount,
  type Account,
  type SignInCodeCheck,
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
const DAY_MS = 24 * HOUR_MS;
// Five codes per email per hour, each locked after five wrong tries, leave a
// guesser 25 tries an hour against a million codes. The IP limit stops one
// network from mailing many addresses.
const CODES_PER_EMAIL_PER_HOUR = 5;
const CODES_PER_IP_PER_HOUR = 20;
// Emails cost ZeptoMail credits, so one day of sign-in requests from many
// networks cannot use them up.
const SIGN_IN_EMAILS_PER_DAY = 300;
// Judges' fixed codes never lock, so the daily limit per email is what keeps
// guessing a million codes hopeless for the weeks of judging.
const CODE_CHECKS_PER_EMAIL_PER_DAY = 20;
const CODE_CHECKS_PER_IP_PER_HOUR = 30;

const emailSchema = z
  .string()
  .trim()
  .max(254)
  .transform((email) => email.toLowerCase())
  .pipe(z.email());

const periods = {
  hour: { length: HOUR_MS, isoPrefix: 13 },
  day: { length: DAY_MS, isoPrefix: 10 },
} as const;

interface Limit {
  subject: string;
  limit: number;
  period: keyof typeof periods;
}

/** Takes one slot from each limit and says whether all of them had room. */
async function takeSlots(
  context: ArenaApiContext,
  now: Date,
  limits: readonly Limit[],
): Promise<boolean> {
  const slots = await Promise.all(
    limits.map(({ subject, limit, period }) => {
      const { length, isoPrefix } = periods[period];
      return takeRateLimitSlot(context.table, {
        subject,
        window: now.toISOString().slice(0, isoPrefix),
        limit,
        expiresAt: new Date(now.getTime() + 2 * length),
      });
    }),
  );
  return slots.every(Boolean);
}

async function openSessionCookie(
  context: ArenaApiContext,
  accountId: string,
  now: Date,
): Promise<string> {
  const token = context.newSessionToken();
  await openSession(context.table, {
    tokenHash: hashToken(token),
    accountId,
    expiresAt: new Date(now.getTime() + SESSION_DAYS * 24 * HOUR_MS),
  });
  return sessionCookie(token);
}

const signInBodySchema = z.object({ email: emailSchema });

export interface SignInRequest {
  body: string;
  sourceIp: string;
}

/**
 * Emails a sign-in code. It answers 202 whether or not the email has an
 * account, so the answer does not tell who has signed up. Judges' accounts
 * have a fixed code, so they get no email.
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
  const allowed = await takeSlots(context, now, [
    { subject: `signin-email#${accountId}`, limit: CODES_PER_EMAIL_PER_HOUR, period: 'hour' },
    {
      subject: `signin-ip#${hashToken(request.sourceIp)}`,
      limit: CODES_PER_IP_PER_HOUR,
      period: 'hour',
    },
  ]);
  if (!allowed) return json(429, { error: 'Too many sign-in codes. Try again next hour' });

  const account = await getAccount(context.table, accountId);
  if (account?.fixedSignInCodeHash !== undefined) return json(202, { sent: true });
  const canEmail = await takeSlots(context, now, [
    { subject: 'signin-emails', limit: SIGN_IN_EMAILS_PER_DAY, period: 'day' },
  ]);
  if (!canEmail) return json(429, { error: 'Sign-in is paused for today. Try again tomorrow' });

  const code = context.newSignInCode();
  await saveSignInCode(context.table, {
    accountId,
    codeHash: hashSignInCode(accountId, code),
    expiresAt: new Date(now.getTime() + CODE_VALID_MINUTES * MINUTE_MS),
  });
  await sendEmail(context.mail.zeptoMail, {
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

function checkCode(
  context: ArenaApiContext,
  account: Account | undefined,
  attempt: { accountId: string; codeHash: string; now: Date },
): Promise<SignInCodeCheck> {
  if (account?.fixedSignInCodeHash === undefined) return checkSignInCode(context.table, attempt);
  return Promise.resolve(account.fixedSignInCodeHash === attempt.codeHash ? 'valid' : 'wrong');
}

/** Checks the code, creates the account on the first sign-in and opens a session. */
export async function verifySignInCode(
  context: ArenaApiContext,
  request: SignInRequest,
): Promise<APIGatewayProxyStructuredResultV2> {
  const parsed = verifyBodySchema.safeParse(parseJson(request.body));
  if (!parsed.success) return json(400, { error: 'Send your email and the six-digit code' });
  const { email, code } = parsed.data;
  const accountId = accountIdForEmail(email);
  const now = context.now();

  const allowed = await takeSlots(context, now, [
    {
      subject: `signin-check-email#${accountId}`,
      limit: CODE_CHECKS_PER_EMAIL_PER_DAY,
      period: 'day',
    },
    {
      subject: `signin-check-ip#${hashToken(request.sourceIp)}`,
      limit: CODE_CHECKS_PER_IP_PER_HOUR,
      period: 'hour',
    },
  ]);
  if (!allowed) return json(429, { error: 'Too many tries. Try again later' });

  const account = await getAccount(context.table, accountId);
  const check = await checkCode(context, account, {
    accountId,
    codeHash: hashSignInCode(accountId, code),
    now,
  });
  if (check !== 'valid') return json(400, { error: codeErrors[check] });

  const [signedIn, cookie] = await Promise.all([
    upsertAccount(context.table, { accountId, email, signedInAt: now }),
    openSessionCookie(context, accountId, now),
  ]);
  return { ...json(200, { access: signedIn.access }), cookies: [cookie] };
}

export async function signOut(
  context: ArenaApiContext,
  cookies: readonly string[],
): Promise<APIGatewayProxyStructuredResultV2> {
  const token = readSessionToken(cookies);
  if (token) await closeSession(context.table, hashToken(token));
  return { statusCode: 204, cookies: [expiredSessionCookie] };
}
