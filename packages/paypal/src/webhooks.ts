import { z } from 'zod';
import type { PayPalClient } from './client';
import { callPayPal, parseJson, parsePayPalResponse } from './errors';

/** The signature headers PayPal sends with every webhook delivery. */
export interface WebhookTransmission {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
}

const transmissionHeadersSchema = z.object({
  'paypal-auth-algo': z.string().min(1),
  'paypal-cert-url': z.url(),
  'paypal-transmission-id': z.string().min(1),
  'paypal-transmission-sig': z.string().min(1),
  'paypal-transmission-time': z.string().min(1),
});

/** Reads the signature headers, or returns undefined when any is missing. */
export function readWebhookTransmission(
  headers: Record<string, string | undefined>,
): WebhookTransmission | undefined {
  const lowerCased = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const result = transmissionHeadersSchema.safeParse(lowerCased);
  if (!result.success) return undefined;
  return {
    authAlgo: result.data['paypal-auth-algo'],
    certUrl: result.data['paypal-cert-url'],
    transmissionId: result.data['paypal-transmission-id'],
    transmissionSig: result.data['paypal-transmission-sig'],
    transmissionTime: result.data['paypal-transmission-time'],
  };
}

export interface WebhookVerificationRequest {
  webhookId: string;
  transmission: WebhookTransmission;
  /** The request body exactly as received. It must be valid JSON. */
  rawEvent: string;
}

const verificationSchema = z.object({ verification_status: z.enum(['SUCCESS', 'FAILURE']) });

/** Asks PayPal whether a webhook delivery was signed by PayPal for our webhook. */
export async function verifyWebhookSignature(
  client: PayPalClient,
  request: WebhookVerificationRequest,
): Promise<boolean> {
  const { transmission } = request;
  const fields = JSON.stringify({
    auth_algo: transmission.authAlgo,
    cert_url: transmission.certUrl,
    transmission_id: transmission.transmissionId,
    transmission_sig: transmission.transmissionSig,
    transmission_time: transmission.transmissionTime,
    webhook_id: request.webhookId,
  });
  // The signature covers the exact bytes PayPal sent, so the event goes in
  // as received. Parsing and serializing it again could change it.
  const body = `${fields.slice(0, -1)},"webhook_event":${request.rawEvent}}`;

  const response = await callPayPal(client, 'verify-webhook', () => {
    const req = client.createRequest('POST', '/v1/notifications/verify-webhook-signature');
    req.contentType('application/json');
    req.text(body);
    req.authenticate([{ oauth2: true }]);
    return req.callAsText();
  });
  const verification = parsePayPalResponse(
    'verify-webhook',
    verificationSchema,
    parseJson(response),
  );
  return verification.verification_status === 'SUCCESS';
}
