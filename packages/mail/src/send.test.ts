import { afterEach, expect, it, vi } from 'vitest';
import { EmailRejectedError, sendEmail } from './send';

const account = { apiUrl: 'https://api.zeptomail.eu', token: 'Zoho-enczapikey test-token' };
const message = {
  from: 'arena@example.com',
  to: 'ada@example.com',
  subject: 'Hello',
  text: 'Body',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

it('posts a plain text email to the ZeptoMail send endpoint', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ message: 'OK' }, { status: 201 }));
  vi.stubGlobal('fetch', fetch);

  await sendEmail(account, message);

  const [url, init] = fetch.mock.calls[0] as [URL, RequestInit];
  expect(url.href).toBe('https://api.zeptomail.eu/v1.1/email');
  expect(init.headers).toEqual({
    Authorization: 'Zoho-enczapikey test-token',
    'Content-Type': 'application/json',
  });
  expect(JSON.parse(init.body as string)).toEqual({
    from: { address: 'arena@example.com', name: 'Handshake Arena' },
    to: [{ email_address: { address: 'ada@example.com' } }],
    subject: 'Hello',
    textbody: 'Body',
  });
});

it('throws with the ZeptoMail error code and request ID when the email is rejected', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { code: 'TM_3201', message: 'Mandatory Field missing', request_id: 'req-1' } },
          { status: 400 },
        ),
      ),
  );

  const error: unknown = await sendEmail(account, message).catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(EmailRejectedError);
  expect(error).toMatchObject({ status: 400, code: 'TM_3201', requestId: 'req-1' });
});
