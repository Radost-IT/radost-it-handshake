import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  attemptCookieName,
  checkAttemptLimit,
  FORM_WINDOW_MS,
  recordAttempt,
  retryAfterMinutes,
  sealAttemptWindow,
  type AttemptLimit,
  type FormName,
} from './attempt-limit';
import { clientIp } from './client-ip';
import { CHALLENGE_ANSWER_FIELD, CHALLENGE_TOKEN_FIELD, HONEYPOT_FIELD } from './fields';
import { formSigningSecret, originVerifySecret } from './form-secret';
import { minutesToNextHour, takeFormIpSlot } from './ip-limit';
import { isSpamChallengeSolved } from './spam-challenge';

// The shared Radost IT contact Lambda posts every submission to Slack. It
// routes on the website key, which must be in its WEBSITES map.
const CONTACT_API_URL = 'https://contact.radostit.com/v1';
const CONTACT_WEBSITE_KEY = 'handshake.radostit.com';

const guardSchema = z.object({
  // A browser never shows this field, so anything in it comes from a bot.
  [HONEYPOT_FIELD]: z.string().max(0).optional(),
  [CHALLENGE_TOKEN_FIELD]: z.string(),
  [CHALLENGE_ANSWER_FIELD]: z.string(),
});

export interface FormDefinition {
  name: FormName;
  /** Parses the visitor's fields into the payload the contact Lambda expects. */
  schema: z.ZodType<Record<string, unknown>>;
  invalidMessage: string;
  failureMessage: string;
}

interface RequestContext {
  secret: string;
  ip: string;
  now: number;
  limit: AttemptLimit;
}

async function readRequestContext(
  req: NextRequest,
  form: FormName,
): Promise<RequestContext | null> {
  const [secret, originSecret] = await Promise.all([formSigningSecret(), originVerifySecret()]);
  const ip = clientIp(req.headers, originSecret);
  if (ip === null) return null;
  const now = Date.now();
  const cookie = req.cookies.get(attemptCookieName(form))?.value;
  return { secret, ip, now, limit: checkAttemptLimit({ secret, form, ip, cookie, now }) };
}

function refuseDirectRequest() {
  return NextResponse.json({ error: 'Send forms through the website' }, { status: 403 });
}

function blockedBody(limit: AttemptLimit) {
  return { blocked: limit.blocked, retryAfterMinutes: retryAfterMinutes(limit.retryAfterMs) };
}

/** Tells a returning browser it is still locked out, so it shows the lock and not a form that will fail. */
export async function respondWithAttemptStatus(req: NextRequest, form: FormName) {
  const context = await readRequestContext(req, form);
  if (!context) return refuseDirectRequest();
  const { limit } = context;
  return NextResponse.json(limit.blocked ? blockedBody(limit) : { blocked: false });
}

export async function handleFormSubmission(req: NextRequest, form: FormDefinition) {
  const context = await readRequestContext(req, form.name);
  if (!context) return refuseDirectRequest();
  if (context.limit.blocked) {
    const minutes = retryAfterMinutes(context.limit.retryAfterMs);
    return NextResponse.json(
      {
        error: `Too many attempts. Try again in ${minutes} minutes.`,
        ...blockedBody(context.limit),
      },
      { status: 429 },
    );
  }

  if (!(await takeFormIpSlot(form.name, context.ip, context.now))) {
    const minutes = minutesToNextHour(context.now);
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${minutes} minutes.` },
      { status: 429 },
    );
  }

  const body: unknown = await req.json().catch(() => null);
  const status = await submitForm(form, body, context);
  return respondCountingAttempt(form.name, context, status);
}

type SubmissionStatus = { ok: true } | { ok: false; status: number; error: string };

async function submitForm(
  form: FormDefinition,
  body: unknown,
  { secret, ip, now }: RequestContext,
): Promise<SubmissionStatus> {
  const guard = guardSchema.safeParse(body);
  const fields = form.schema.safeParse(body);
  if (!guard.success || !fields.success) {
    return { ok: false, status: 400, error: form.invalidMessage };
  }

  const answer = guard.data[CHALLENGE_ANSWER_FIELD];
  if (!isSpamChallengeSolved(secret, guard.data[CHALLENGE_TOKEN_FIELD], answer, now)) {
    return { ok: false, status: 400, error: 'That sum is not right. Try the new one.' };
  }

  const delivered = await postToContactApi(form.name, fields.data, ip);
  return delivered ? { ok: true } : { ok: false, status: 502, error: form.failureMessage };
}

function respondCountingAttempt(form: FormName, context: RequestContext, result: SubmissionStatus) {
  const response = result.ok
    ? NextResponse.json({ success: true })
    : NextResponse.json({ error: result.error }, { status: result.status });

  const window = recordAttempt({ form, ip: context.ip, limit: context.limit, now: context.now });
  response.cookies.set({
    name: attemptCookieName(form),
    value: sealAttemptWindow(context.secret, window),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: FORM_WINDOW_MS / 1000,
  });
  return response;
}

// The visitor's IP goes along so the Lambda's own per-IP limit counts the
// visitor, not this server.
async function postToContactApi(
  form: FormName,
  payload: Record<string, unknown>,
  ip: string,
): Promise<boolean> {
  const response = await fetch(`${CONTACT_API_URL}/${form}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ ...payload, website: CONTACT_WEBSITE_KEY }),
    cache: 'no-store',
  });
  if (response.ok) return true;

  console.log(
    JSON.stringify({
      level: 'error',
      message: 'Contact API rejected a form',
      form,
      status: response.status,
    }),
  );
  return false;
}
