import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithSession, readSession, storeSession, type SessionTokens } from './session';

const soon = (minutes: number) => new Date(Date.now() + minutes * 60 * 1000).toISOString();
const stored: SessionTokens = {
  accessToken: 'hs_session_old',
  refreshToken: 'session-1.old',
  accessTokenExpiresAt: soon(30),
};
const renewed: SessionTokens = {
  accessToken: 'hs_session_new',
  refreshToken: 'session-1.new',
  accessTokenExpiresAt: soon(60),
};

const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
const authorizationOf = (call: number) =>
  (fetch.mock.calls[call]?.[1].headers as Record<string, string>).authorization;
const refreshCalls = () =>
  fetch.mock.calls.filter(([url]) => url.endsWith('/arena/session/refresh'));

function answerRefresh(response: () => Response): void {
  fetch.mockImplementation((url, init) => {
    if (url.endsWith('/arena/session/refresh')) return Promise.resolve(response());
    const authorization = (init.headers as Record<string, string>).authorization;
    return Promise.resolve(
      new Response(null, { status: authorization === 'Bearer hs_session_new' ? 200 : 401 }),
    );
  });
}

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', {
    locks: { request: (_name: string, work: () => Promise<unknown>) => work() },
  });
  vi.stubGlobal('fetch', fetch);
  fetch.mockReset();
  storeSession(stored);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchWithSession', () => {
  it('sends the access token', async () => {
    fetch.mockResolvedValue(new Response(null, { status: 200 }));

    await fetchWithSession('https://api.test/arena/account', {});

    expect(authorizationOf(0)).toBe('Bearer hs_session_old');
  });

  it('renews the tokens after a 401 and sends the call again', async () => {
    answerRefresh(() => Response.json({ session: renewed }));

    const response = await fetchWithSession('https://api.test/arena/account', {});

    expect(response.status).toBe(200);
    expect(readSession()).toEqual(renewed);
    expect(JSON.parse(refreshCalls()[0]?.[1].body as string)).toEqual({
      refreshToken: 'session-1.old',
    });
  });

  it('renews a token that is about to run out before sending the call', async () => {
    storeSession({ ...stored, accessTokenExpiresAt: soon(0.5) });
    answerRefresh(() => Response.json({ session: renewed }));

    await fetchWithSession('https://api.test/arena/account', {});

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(authorizationOf(1)).toBe('Bearer hs_session_new');
  });

  it('shares one renewal between calls made at the same time', async () => {
    answerRefresh(() => Response.json({ session: renewed }));

    await Promise.all([
      fetchWithSession('https://api.test/arena/account', {}),
      fetchWithSession('https://api.test/arena/deals', {}),
    ]);

    expect(refreshCalls()).toHaveLength(1);
  });

  it('forgets the tokens once the API ends the session', async () => {
    answerRefresh(() => new Response(null, { status: 401 }));

    const response = await fetchWithSession('https://api.test/arena/account', {});

    expect(response.status).toBe(401);
    expect(readSession()).toBeNull();
  });

  it('keeps the tokens when the API cannot renew them for now', async () => {
    answerRefresh(() => new Response(null, { status: 503 }));

    await expect(fetchWithSession('https://api.test/arena/account', {})).rejects.toThrow(
      'not answering',
    );
    expect(readSession()).toEqual(stored);
  });

  it('sends no token for a visitor who has not signed in', async () => {
    localStorage.removeItem('handshake-session');
    fetch.mockResolvedValue(new Response(null, { status: 401 }));

    await fetchWithSession('https://api.test/arena/account', {});

    expect(authorizationOf(0)).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
