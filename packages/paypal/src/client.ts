import {
  Client,
  Environment,
  OrdersController,
  PaymentsController,
  type Configuration,
  type OAuthToken,
} from '@paypal/paypal-server-sdk';
import { PAYPAL_SANDBOX_BASE_URL, type Config } from '@handshake/config';

export interface PayPalClient {
  orders: OrdersController;
  payments: PaymentsController;
  /** Raw request builder for PayPal APIs the SDK does not cover, such as webhook verification. */
  createRequest: ReturnType<Client['getRequestBuilderFactory']>;
  /** Returns the error from the last failed token request once, then forgets it. */
  consumeTokenFailure: () => unknown;
}

const REQUEST_TIMEOUT_MS = 15_000;

/** Prefer header that makes PayPal return the full resource, which our parsers need. */
export const RETURN_REPRESENTATION = 'return=representation';

/**
 * Builds a long-lived sandbox client. Create it once per process and reuse it,
 * so the OAuth token is cached across Lambda invocations.
 */
export function createPayPalClient(config: Config['paypal']): PayPalClient {
  return buildPayPalClient(config, {});
}

/** Same as `createPayPalClient`, with extra SDK options for tests (a stub transport). */
export function buildPayPalClient(
  config: Config['paypal'],
  extraConfiguration: Partial<Configuration>,
): PayPalClient {
  if (config.baseUrl !== PAYPAL_SANDBOX_BASE_URL) {
    throw new Error('Only the PayPal sandbox is supported');
  }

  let tokenFailure: unknown;
  const client = new Client({
    environment: Environment.Sandbox,
    timeout: REQUEST_TIMEOUT_MS,
    clientCredentialsAuthCredentials: {
      oAuthClientId: config.clientId,
      oAuthClientSecret: config.clientSecret,
      oAuthClockSkew: 60,
      // The SDK caches a rejected token promise for the life of the client, so one
      // failed token request would break every later call in a warm Lambda. Resolve
      // with an expired token instead: this call fails, the next one fetches again.
      oAuthTokenProvider: async (lastToken, authManager) => {
        try {
          return await authManager.updateToken(lastToken);
        } catch (error) {
          tokenFailure = error;
          return expiredToken();
        }
      },
    },
    httpClientOptions: {
      retryConfig: {
        maxNumberOfRetries: 2,
        retryInterval: 1,
        backoffFactor: 2,
        maximumRetryWaitTime: 10,
        // Every POST we send carries a PayPal-Request-Id, so PayPal replays the
        // first result instead of moving money twice.
        httpMethodsToRetry: ['GET', 'POST'],
      },
    },
    ...extraConfiguration,
  });

  return {
    orders: new OrdersController(client),
    payments: new PaymentsController(client),
    createRequest: client.getRequestBuilderFactory(),
    consumeTokenFailure: () => {
      const failure = tokenFailure;
      tokenFailure = undefined;
      return failure;
    },
  };
}

function expiredToken(): OAuthToken {
  return { accessToken: '', tokenType: 'Bearer', expiry: 0n };
}
