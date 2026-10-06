import { MAX_ACCESS_REASON_LENGTH, MIN_ACCESS_REASON_LENGTH } from '@handshake/arena';
import { accessRequestEmail, sendEmail } from '@handshake/mail';
import { getChallenger, requestAccess } from '@handshake/store';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { publicChallenger } from './arena-challengers';
import { json, parseJson } from './http';
import { findSessionAccount, type ArenaApiContext } from './arena-session';

/** The signed-in account, its access status and its challenger once it has one. */
export async function getAccountFromSession(
  context: ArenaApiContext,
  authorization: string | undefined,
): Promise<APIGatewayProxyStructuredResultV2> {
  const session = await findSessionAccount(context, authorization);
  if (!session.found) return session.response;
  const { account } = session;
  const challenger = account.challengerId
    ? await getChallenger(context.table, account.challengerId)
    : undefined;
  return json(200, {
    email: account.email,
    access: account.access,
    challenger: challenger ? publicChallenger(challenger) : null,
  });
}

const accessRequestBodySchema = z.object({ reason: z.string().max(MAX_ACCESS_REASON_LENGTH * 2) });

/** Stores why the person wants to join and emails the request to the admin. */
export async function requestAccessFromSession(
  context: ArenaApiContext,
  request: { body: string; authorization: string | undefined },
): Promise<APIGatewayProxyStructuredResultV2> {
  const session = await findSessionAccount(context, request.authorization);
  if (!session.found) return session.response;
  const parsed = accessRequestBodySchema.safeParse(parseJson(request.body));
  if (!parsed.success) return json(400, { error: 'Send a JSON body with a reason' });
  const reason = parsed.data.reason.trim();
  if (reason.length < MIN_ACCESS_REASON_LENGTH || reason.length > MAX_ACCESS_REASON_LENGTH) {
    return json(400, {
      error: `Write between ${MIN_ACCESS_REASON_LENGTH} and ${MAX_ACCESS_REASON_LENGTH} characters`,
    });
  }

  const { account } = session;
  const stored = await requestAccess(context.table, account.id, {
    reason,
    requestedAt: context.now(),
  });
  if (!stored) return json(409, { error: 'You have already asked to join' });

  const command = `pnpm arena:access ${context.table.name}`;
  const email = quoteForShell(account.email);
  await sendEmail(context.mail.zeptoMail, {
    from: context.mail.from,
    to: context.mail.adminEmail,
    ...accessRequestEmail({
      email: account.email,
      reason,
      approveCommand: `${command} approve ${email}`,
      rejectCommand: `${command} reject ${email}`,
    }),
  });
  return json(202, { access: 'pending' });
}

// The admin pastes these commands into a shell, and a valid email may contain a quote.
function quoteForShell(value: string): string {
  return /^[\w@.+-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}
