import {
  API_KEY_PREFIX,
  findApiKey,
  hasDealAccess,
  isDealOwner,
  type ApiKey,
  type StoreTable,
} from '@handshake/store';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { hashToken, json } from './http';

export function readBearerToken(authorization: string | undefined): string | undefined {
  const match = /^Bearer (\S+)$/.exec(authorization ?? '');
  return match?.[1];
}

/** The developer whose API key is in the Authorization header. */
export async function findDeveloper(
  table: StoreTable,
  authorization: string | undefined,
): Promise<ApiKey | undefined> {
  const token = readBearerToken(authorization);
  return token === undefined ? undefined : findApiKey(table, token);
}

/** The error response for a caller who may not act on the deal, or undefined when they may. */
export async function refuseDealAccess(
  table: StoreTable,
  dealId: string,
  authorization: string | undefined,
): Promise<APIGatewayProxyStructuredResultV2 | undefined> {
  const token = readBearerToken(authorization);
  if (token === undefined) {
    return json(401, { error: 'Send an API key or the deal access token' });
  }
  // A wrong token and an unknown deal look the same, so tokens cannot be used to find deals.
  if (!(await canActOnDeal(table, dealId, token))) {
    return json(404, { error: 'Deal not found' });
  }
  return undefined;
}

/**
 * The developer who opened the deal acts with their API key; the buyer acts
 * with the deal's access token.
 */
async function canActOnDeal(table: StoreTable, dealId: string, token: string): Promise<boolean> {
  if (!token.startsWith(API_KEY_PREFIX)) {
    return hasDealAccess(table, dealId, hashToken(token));
  }
  const developer = await findApiKey(table, token);
  return developer !== undefined && isDealOwner(table, dealId, developer.developerId);
}
