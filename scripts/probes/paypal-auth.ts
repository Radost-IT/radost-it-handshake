import { loadConfig } from '@handshake/config';
import { z } from 'zod';

// Only non-secret fields are parsed, so the token never leaves this function.
const tokenResponseSchema = z.object({
  token_type: z.string(),
  expires_in: z.number(),
  app_id: z.string(),
});

const config = await loadConfig();
const credentials = Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString(
  'base64',
);

const response = await fetch(`${config.paypal.baseUrl}/v1/oauth2/token`, {
  method: 'POST',
  headers: {
    authorization: `Basic ${credentials}`,
    'content-type': 'application/x-www-form-urlencoded',
  },
  body: 'grant_type=client_credentials',
});

if (!response.ok) {
  const debugId = response.headers.get('paypal-debug-id') ?? 'none';
  console.error(`PayPal sandbox auth failed: HTTP ${response.status}, debug_id ${debugId}`);
  process.exit(1);
}

const token = tokenResponseSchema.parse(await response.json());
console.log(
  `PayPal sandbox auth OK: ${token.token_type} token for app ${token.app_id}, expires in ${token.expires_in}s`,
);
