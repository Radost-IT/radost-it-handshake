import { hasValidSignature, signFormValue } from './signature';

export const MAX_FORM_ATTEMPTS = 5;
export const FORM_WINDOW_MS = 60 * 60 * 1000;

export type FormName = 'contact' | 'newsletter';

export interface AttemptWindow {
  count: number;
  startedAt: number;
}

export interface AttemptLimit extends AttemptWindow {
  blocked: boolean;
  retryAfterMs: number;
}

export const attemptCookieName = (form: FormName) => `hs_${form}`;

// The cookie survives a new tab or window; the IP counter covers a visitor who
// clears cookies. Both only tell the browser it is locked out: the IP counter
// lives per warm Lambda instance, so `takeFormIpSlot` enforces the limit.
const attemptsByIp = new Map<string, AttemptWindow>();

const isOpen = (window: AttemptWindow, now: number) => now - window.startedAt < FORM_WINDOW_MS;

export function sealAttemptWindow(secret: string, window: AttemptWindow): string {
  const value = `${window.count}.${window.startedAt}`;
  return `${value}.${signFormValue(secret, value)}`;
}

function unsealAttemptWindow(secret: string, sealed: string): AttemptWindow | null {
  const [count, startedAt, signature] = sealed.split('.');
  if (!count || !startedAt || !signature) return null;
  if (!hasValidSignature(secret, `${count}.${startedAt}`, signature)) return null;
  return { count: Number(count), startedAt: Number(startedAt) };
}

export function checkAttemptLimit(input: {
  secret: string;
  form: FormName;
  ip: string;
  cookie: string | undefined;
  now: number;
}): AttemptLimit {
  const { secret, form, ip, cookie, now } = input;
  const windows = [
    cookie === undefined ? null : unsealAttemptWindow(secret, cookie),
    attemptsByIp.get(`${form}:${ip}`) ?? null,
  ].filter((window): window is AttemptWindow => window !== null && isOpen(window, now));

  // The stricter of the two wins, so neither clearing cookies nor a shared IP resets the count.
  const count = Math.max(0, ...windows.map((window) => window.count));
  const startedAt = Math.min(now, ...windows.map((window) => window.startedAt));
  const blocked = count >= MAX_FORM_ATTEMPTS;

  return {
    count,
    startedAt,
    blocked,
    retryAfterMs: blocked ? Math.max(0, startedAt + FORM_WINDOW_MS - now) : 0,
  };
}

/**
 * Counts one more attempt and returns the window to store in the cookie. Every
 * outcome counts, including a wrong sum, so the sum cannot be guessed by resubmitting.
 */
export function recordAttempt(input: {
  form: FormName;
  ip: string;
  limit: AttemptLimit;
  now: number;
}): AttemptWindow {
  const { form, ip, limit, now } = input;
  // Later attempts keep the first one's clock, so resubmitting does not extend the window.
  const window = { count: limit.count + 1, startedAt: limit.count === 0 ? now : limit.startedAt };
  attemptsByIp.set(`${form}:${ip}`, window);

  if (attemptsByIp.size > 500) {
    for (const [key, entry] of attemptsByIp) {
      if (!isOpen(entry, now)) attemptsByIp.delete(key);
    }
  }
  return window;
}

export const retryAfterMinutes = (retryAfterMs: number) =>
  Math.max(1, Math.ceil(retryAfterMs / 60_000));
