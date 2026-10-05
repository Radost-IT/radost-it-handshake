import { PAYPAL_SANDBOX_BASE_URL } from '@handshake/config';
import { buildPayPalClient, type PayPalCallObserver, type PayPalClient } from './client';

export interface StubResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface SentRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  rawBody: string | undefined;
}

interface AxiosLikeConfig {
  method: string;
  url: string;
  headers: Record<string, string>;
  data?: string;
}

const tokenResponse: StubResponse = {
  status: 200,
  body: { access_token: 'stub-token', token_type: 'Bearer', expires_in: 3600 },
};

/**
 * A PayPal client whose HTTP calls are answered in order by `responses`.
 * Token requests get a valid token unless `tokenResponses` says otherwise.
 */
export function stubPayPalClient(
  responses: StubResponse[],
  tokenResponses: StubResponse[] = [],
  onCall?: PayPalCallObserver,
): { client: PayPalClient; sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  const client = buildPayPalClient(
    {
      clientId: 'stub-client-id',
      clientSecret: 'stub-client-secret',
      baseUrl: PAYPAL_SANDBOX_BASE_URL,
      webhookId: undefined,
      honorPeriodHours: 72,
    },
    {
      httpClientOptions: { retryConfig: { maxNumberOfRetries: 0 } },
      unstable_httpClientOptions: {
        adapter: (config: AxiosLikeConfig) => {
          const isTokenRequest = config.url.endsWith('/v1/oauth2/token');
          if (!isTokenRequest) {
            sent.push({
              method: config.method.toUpperCase(),
              url: config.url,
              headers: config.headers,
              body: config.data === undefined ? undefined : JSON.parse(config.data),
              rawBody: config.data,
            });
          }
          const next = isTokenRequest
            ? (tokenResponses.shift() ?? tokenResponse)
            : responses.shift();
          if (next === undefined) throw new Error(`No stub response for ${config.url}`);
          return Promise.resolve({
            data: JSON.stringify(next.body),
            status: next.status,
            statusText: '',
            headers: { 'content-type': 'application/json', ...next.headers },
            config,
          });
        },
      },
    },
    onCall,
  );
  return { client, sent };
}

export function lastSent(sent: SentRequest[]): SentRequest {
  const request = sent.at(-1);
  if (request === undefined) throw new Error('No request was sent');
  return request;
}
