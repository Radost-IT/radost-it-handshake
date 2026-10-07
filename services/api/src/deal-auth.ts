import {
  ACCOUNT_DEVELOPER_PREFIX,
  accountDeveloperId,
  API_KEY_PREFIX,
  findAccessTokenAccountId,
  findApiKey,
  getAccount,
  getDealBrief,
  getMerchant,
  hasDealAccess,
  isDealOwner,
  type StoreTable,
} from '@handshake/store';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { readAccessToken } from './arena-session';
import { hashToken, json, readBearerToken } from './http';

/** What a Deal API request carries to prove who sends it. */
export interface DealCredentials {
  /**
   * The Authorization header: an API key, a deal access token, or the console's
   * session access token for a signed-in, approved account.
   */
  authorization: string | undefined;
}

export interface Developer {
  developerId: string;
}

async function findSessionDeveloper(
  table: StoreTable,
  token: string,
  now: Date,
): Promise<Developer | undefined> {
  const accountId = await findAccessTokenAccountId(table, hashToken(token), now);
  const account = accountId ? await getAccount(table, accountId) : undefined;
  return account?.access === 'approved'
    ? { developerId: accountDeveloperId(account.id) }
    : undefined;
}

/**
 * The developer behind the request: the approved account of a session access
 * token, or else the owner of the API key.
 */
export async function findDeveloper(
  table: StoreTable,
  credentials: DealCredentials,
  now: Date,
): Promise<Developer | undefined> {
  const sessionToken = readAccessToken(credentials.authorization);
  if (sessionToken !== undefined) return findSessionDeveloper(table, sessionToken, now);
  const token = readBearerToken(credentials.authorization);
  return token === undefined ? undefined : findApiKey(table, token);
}

/**
 * True when the request is signed with a developer API key. Agents hold the
 * key, so the person's decisions on a deal refuse it.
 */
export function isSignedWithApiKey(credentials: DealCredentials): boolean {
  return readBearerToken(credentials.authorization)?.startsWith(API_KEY_PREFIX) ?? false;
}

/** The error response for a caller who may not act on the deal, or undefined when they may. */
export async function refuseDealAccess(
  table: StoreTable,
  dealId: string,
  credentials: DealCredentials,
  now: Date,
): Promise<APIGatewayProxyStructuredResultV2 | undefined> {
  const token = readBearerToken(credentials.authorization);
  if (token === undefined) {
    return json(401, { error: 'Send an API key or the deal access token' });
  }
  // A wrong token and an unknown deal look the same, so tokens cannot be used to find deals.
  if (!(await canActOnDeal(table, dealId, credentials, now))) {
    return json(404, { error: 'Deal not found' });
  }
  return undefined;
}

/**
 * The developer who opened the deal acts with their API key or session; the
 * buyer acts with the deal's access token.
 */
async function canActOnDeal(
  table: StoreTable,
  dealId: string,
  credentials: DealCredentials,
  now: Date,
): Promise<boolean> {
  const token = readBearerToken(credentials.authorization);
  const isDealToken =
    token !== undefined &&
    !isSignedWithApiKey(credentials) &&
    readAccessToken(credentials.authorization) === undefined;
  if (isDealToken) return hasDealAccess(table, dealId, hashToken(token));
  const developer = await findDeveloper(table, credentials, now);
  return developer !== undefined && isDealOwner(table, dealId, developer.developerId);
}

/**
 * Like refuseDealAccess, but also lets the merchant whose seller agent sold
 * the deal report its delivery, with their API key or session.
 */
export async function refuseDeliveryReport(
  table: StoreTable,
  dealId: string,
  credentials: DealCredentials,
  now: Date,
): Promise<APIGatewayProxyStructuredResultV2 | undefined> {
  const refusal = await refuseDealAccess(table, dealId, credentials, now);
  if (refusal?.statusCode !== 404) return refusal;
  return (await isDealMerchant(table, dealId, credentials, now)) ? undefined : refusal;
}

async function isDealMerchant(
  table: StoreTable,
  dealId: string,
  credentials: DealCredentials,
  now: Date,
): Promise<boolean> {
  const developer = await findDeveloper(table, credentials, now);
  if (!developer?.developerId.startsWith(ACCOUNT_DEVELOPER_PREFIX)) return false;
  const accountId = developer.developerId.slice(ACCOUNT_DEVELOPER_PREFIX.length);
  const [merchant, brief] = await Promise.all([
    getMerchant(table, accountId),
    getDealBrief(table, dealId),
  ]);
  const sellerId = brief?.sellerId;
  return sellerId != null && merchant?.sellerIds.includes(sellerId) === true;
}
