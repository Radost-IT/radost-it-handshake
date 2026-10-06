import { z } from 'zod';
import { API_URL } from '../site';

const STORAGE_KEY = 'handshake-session';
// The storage event reaches only other tabs, so this tab announces its own changes.
const CHANGE_EVENT = 'handshake-session-change';
// Renew a little early, so a token does not run out while its request is on the way.
const RENEW_BEFORE_EXPIRY_MS = 60 * 1000;

export const sessionTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  accessTokenExpiresAt: z.iso.datetime(),
});

export type SessionTokens = z.infer<typeof sessionTokensSchema>;

export function readSession(): SessionTokens | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return null;
    const parsed = sessionTokensSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function storeSession(tokens: SessionTokens): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  } catch {
    // Without storage the visitor signs in again on the next page load.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing was stored.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Calls `listener` whenever this or another tab signs in or out. Returns the unsubscribe. */
export function onSessionChange(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

/** The browser cannot reach the API to renew the session. The stored tokens are kept. */
class SessionRenewalError extends Error {
  override name = 'SessionRenewalError';
}

async function swapTokens(stale: SessionTokens): Promise<SessionTokens | null> {
  const current = readSession();
  if (current === null) return null;
  // Another tab renewed the session while this one waited for the lock.
  if (current.refreshToken !== stale.refreshToken) return current;
  const response = await fetch(`${API_URL}/arena/session/refresh`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  });
  if (response.status === 401) {
    clearSession();
    return null;
  }
  if (!response.ok) throw new SessionRenewalError('The arena is not answering. Try again soon');
  const { session } = z.object({ session: sessionTokensSchema }).parse(await response.json());
  storeSession(session);
  return session;
}

let renewal: Promise<SessionTokens | null> | null = null;

/**
 * Swaps the refresh token for new tokens and resolves to null once the session
 * has ended. Calls made meanwhile share one renewal, and the lock keeps tabs
 * from swapping the same refresh token twice, which the API treats as theft.
 */
function renewSession(stale: SessionTokens): Promise<SessionTokens | null> {
  renewal ??= navigator.locks
    .request('handshake-session-renewal', () => swapTokens(stale))
    .finally(() => {
      renewal = null;
    });
  return renewal;
}

type ApiRequestInit = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> };

function expiresSoon(tokens: SessionTokens): boolean {
  return Date.parse(tokens.accessTokenExpiresAt) - Date.now() < RENEW_BEFORE_EXPIRY_MS;
}

function send(url: string, init: ApiRequestInit, tokens: SessionTokens | null): Promise<Response> {
  return fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      ...init.headers,
      ...(tokens === null ? {} : { authorization: `Bearer ${tokens.accessToken}` }),
    },
  });
}

/** Calls the API as the signed-in account, renewing the access token when it has run out. */
export async function fetchWithSession(url: string, init: ApiRequestInit): Promise<Response> {
  const stored = readSession();
  const tokens = stored !== null && expiresSoon(stored) ? await renewSession(stored) : stored;
  const response = await send(url, init, tokens);
  if (response.status !== 401 || tokens === null) return response;
  const renewed = await renewSession(tokens);
  return renewed === null ? response : send(url, init, renewed);
}
