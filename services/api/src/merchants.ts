import { MIN_ACCESS_REASON_LENGTH } from '@handshake/arena';
import { merchantApplicationEmail, sendEmail } from '@handshake/mail';
import {
  accountDeveloperId,
  getMerchant,
  getSellers,
  listApiKeys,
  merchantSchema,
  requestAccess,
  saveMerchant,
  type Seller,
} from '@handshake/store';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { quoteForShell } from './arena-access';
import { findSessionAccount, type ArenaApiContext } from './arena-session';
import { json, parseJson } from './http';

const MAX_PRODUCTS_LENGTH = 300;

const applicationSchema = z.object({
  businessName: z.string().trim().min(2).max(100),
  website: merchantSchema.shape.website,
  payoutEmail: merchantSchema.shape.payoutEmail,
  products: z.string().trim().min(MIN_ACCESS_REASON_LENGTH).max(MAX_PRODUCTS_LENGTH),
});

/**
 * Saves a merchant application and emails it to the admin. Like any access
 * request, the account stays pending until the admin approves it.
 */
export async function applyAsMerchant(
  context: ArenaApiContext,
  request: { body: string; authorization: string | undefined },
): Promise<APIGatewayProxyStructuredResultV2> {
  const session = await findSessionAccount(context, request.authorization);
  if (!session.found) return session.response;
  const parsed = applicationSchema.safeParse(parseJson(request.body));
  if (!parsed.success) {
    return json(400, {
      error: `Send your business name, website, PayPal business email and what you sell in ${String(MIN_ACCESS_REASON_LENGTH)} to ${String(MAX_PRODUCTS_LENGTH)} characters`,
    });
  }
  const application = parsed.data;
  const { account } = session;
  const now = context.now();
  const stored = await requestAccess(context.table, account.id, {
    reason: `Merchant application from ${application.businessName}: ${application.products}`,
    requestedAt: now,
  });
  if (!stored) return json(409, { error: 'You have already asked to join' });
  await saveMerchant(context.table, {
    accountId: account.id,
    ...application,
    sellerIds: [],
    createdAt: now.toISOString(),
  });

  const command = `pnpm arena:access ${context.table.name}`;
  const email = quoteForShell(account.email);
  await sendEmail(context.mail.zeptoMail, {
    from: context.mail.from,
    to: context.mail.adminEmail,
    ...merchantApplicationEmail({
      email: account.email,
      ...application,
      approveCommand: `${command} approve ${email}`,
      rejectCommand: `${command} reject ${email}`,
    }),
  });
  return json(202, { access: 'pending' });
}

const publicSeller = (seller: Seller) => ({
  sellerId: seller.sellerId,
  name: seller.name,
  persona: seller.persona,
  floorPrice: seller.floorPrice,
  listing: { title: seller.listing.title, listPrice: seller.listing.listPrice },
});

/** The approved account's merchant profile, its API keys without the secret part, and its seller agents. */
export async function getMerchantSettings(
  context: ArenaApiContext,
  authorization: string | undefined,
): Promise<APIGatewayProxyStructuredResultV2> {
  const session = await findSessionAccount(context, authorization);
  if (!session.found) return session.response;
  const { account } = session;
  if (account.access !== 'approved') {
    return json(403, { error: 'Your merchant access is not approved' });
  }
  const [merchant, apiKeys] = await Promise.all([
    getMerchant(context.table, account.id),
    listApiKeys(context.table, accountDeveloperId(account.id)),
  ]);
  const sellers = merchant ? await getSellers(context.table, merchant.sellerIds) : [];
  return json(200, {
    merchant: merchant
      ? {
          businessName: merchant.businessName,
          website: merchant.website,
          payoutEmail: merchant.payoutEmail,
          products: merchant.products,
          createdAt: merchant.createdAt,
        }
      : null,
    apiKeys: apiKeys.map(({ name, createdAt, lastCharacters }) => ({
      name,
      createdAt,
      lastCharacters,
    })),
    sellers: sellers.map(publicSeller),
  });
}
