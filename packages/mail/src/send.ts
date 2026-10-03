import { z } from 'zod';

export interface Email {
  subject: string;
  text: string;
}

export interface ZeptoMailAccount {
  /** Regional API host, such as https://api.zeptomail.eu. */
  apiUrl: string;
  /** Send Mail token as ZeptoMail shows it, including the `Zoho-enczapikey` prefix. */
  token: string;
}

const SENDER_NAME = 'Handshake Arena';

const errorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), request_id: z.string().optional() }),
});

export class EmailRejectedError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    readonly requestId: string | undefined,
  ) {
    super(`ZeptoMail rejected the email with status ${String(status)}${code ? ` (${code})` : ''}`);
    this.name = 'EmailRejectedError';
  }
}

export async function sendEmail(
  account: ZeptoMailAccount,
  message: Email & { from: string; to: string },
): Promise<void> {
  const response = await fetch(new URL('/v1.1/email', account.apiUrl), {
    method: 'POST',
    headers: { Authorization: account.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: { address: message.from, name: SENDER_NAME },
      to: [{ email_address: { address: message.to } }],
      subject: message.subject,
      textbody: message.text,
    }),
  });
  if (response.ok) return;
  // A gateway error can come back as HTML; the status alone still says what failed.
  const body = errorBodySchema.safeParse(await response.json().catch(() => undefined));
  throw new EmailRejectedError(response.status, body.data?.error.code, body.data?.error.request_id);
}
