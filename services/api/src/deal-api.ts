import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { StartExecutionCommand } from '@aws-sdk/client-sfn';
import { createDeal, deliveryEvidenceSchema, mandateSchema, transitionDeal } from '@handshake/core';
import {
  dailyDealsSubject,
  getDeal,
  getDealRecord,
  grantDealAccess,
  listDeveloperDeals,
  MAX_LISTED_DEALS,
  saveDeal,
  saveDealBrief,
  saveDealOwner,
  saveEvidence,
  takeRateLimitSlot,
} from '@handshake/store';
import { resumeLifecycle, type ResumeContext } from '@handshake/workflows/resume-lifecycle';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DealRequest } from './deal-approvals';
import {
  findDeveloper,
  refuseDealAccess,
  refuseDeliveryReport,
  type DealCredentials,
} from './deal-auth';
import { hashToken, json, parseJson } from './http';

export interface DealApiContext extends ResumeContext {
  dealLifecycleArn: string;
  /** The web app, where the buyer follows and approves the deal. */
  webUrl: string;
}

type Response = APIGatewayProxyStructuredResultV2;

// Each deal runs several model calls, so a key opens a bounded number per day.
const DEALS_PER_DEVELOPER_PER_DAY = 25;

const openDealSchema = z.object({
  goal: z.string().trim().min(3).max(500),
  mandate: mandateSchema,
  /** A seeded seller to negotiate with. Without one, the buyer agent shops the catalog. */
  sellerId: z.string().trim().min(1).max(100).optional(),
});

/**
 * Opens a deal for the developer's buyer and starts its lifecycle: the agents
 * negotiate, then the buyer approves the PayPal checkout from the deal page.
 * The access token is returned once and lets the buyer act on the deal.
 */
export async function openDeal(
  context: DealApiContext,
  request: DealCredentials & { body: string },
): Promise<Response> {
  const developer = await findDeveloper(context.table, request, new Date(context.now()));
  if (!developer) return json(401, { error: 'Send a valid API key or sign in' });
  const input = openDealSchema.safeParse(parseJson(request.body));
  if (!input.success) return json(400, { error: z.prettifyError(input.error) });

  const now = context.now();
  const tomorrow = new Date(Date.parse(now.slice(0, 10)) + 24 * 60 * 60 * 1000);
  const allowed = await takeRateLimitSlot(context.table, {
    subject: dailyDealsSubject(developer.developerId),
    window: now.slice(0, 10),
    limit: DEALS_PER_DEVELOPER_PER_DAY,
    expiresAt: tomorrow,
  });
  if (!allowed) return json(429, { error: 'You have opened all your deals for today' });

  const created = createDeal(randomUUID(), input.data.mandate, now);
  const opened = transitionDeal(created.deal, { to: 'NEGOTIATING' }, now, 'Opened through the API');
  const deal = opened.deal;
  const accessToken = randomBytes(32).toString('base64url');
  // The deal is saved last of these writes, so the agents never start on a deal without a brief.
  await Promise.all([
    saveDealBrief(context.table, deal.id, {
      goal: input.data.goal,
      sellerId: input.data.sellerId ?? null,
      buyerId: developer.developerId,
    }),
    saveDealOwner(context.table, deal.id, { developerId: developer.developerId, createdAt: now }),
    grantDealAccess(context.table, deal.id, hashToken(accessToken)),
  ]);
  await saveDeal(context.table, deal, [created.event, opened.event]);
  await context.stepFunctions.send(
    new StartExecutionCommand({
      stateMachineArn: context.dealLifecycleArn,
      name: deal.id,
      input: JSON.stringify({ dealId: deal.id }),
    }),
  );

  return json(201, {
    deal,
    accessToken,
    // The fragment never reaches a server, so the token stays out of access logs.
    buyerUrl: `${context.webUrl}/deals/${deal.id}#token=${accessToken}`,
  });
}

export async function listDeals(
  context: DealApiContext,
  request: DealCredentials,
): Promise<Response> {
  const developer = await findDeveloper(context.table, request, new Date(context.now()));
  if (!developer) return json(401, { error: 'Send a valid API key or sign in' });
  const deals = await listDeveloperDeals(context.table, developer.developerId, MAX_LISTED_DEALS);
  return json(200, { deals });
}

/** The deal with its events, negotiation, PayPal calls and webhooks. */
export async function readDeal(context: DealApiContext, request: DealRequest): Promise<Response> {
  const refusal = await refuseDealAccess(
    context.table,
    request.dealId,
    request,
    new Date(context.now()),
  );
  if (refusal) return refusal;
  const record = await getDealRecord(context.table, request.dealId);
  return record ? json(200, record) : json(404, { error: 'Deal not found' });
}

/**
 * Delivery evidence for a deal that waits for it. In the sandbox the developer
 * plays the seller and sends it; the verifier then checks it against the contract.
 */
export async function submitEvidence(
  context: DealApiContext,
  request: DealRequest,
): Promise<Response> {
  const refusal = await refuseDeliveryReport(
    context.table,
    request.dealId,
    request,
    new Date(context.now()),
  );
  if (refusal) return refusal;
  const evidence = deliveryEvidenceSchema.safeParse(parseJson(request.body));
  if (!evidence.success) return json(400, { error: z.prettifyError(evidence.error) });

  const deal = await getDeal(context.table, request.dealId);
  if (deal?.state !== 'AWAITING_DELIVERY') {
    return json(409, { error: 'The deal is not waiting for delivery evidence' });
  }
  try {
    await saveEvidence(context.table, request.dealId, evidence.data);
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return json(409, { error: 'Evidence for this deal was already sent' });
    }
    throw error;
  }
  const resumed = await resumeLifecycle(context, request.dealId, 'evidence', {});
  if (!resumed) return json(409, { error: 'The deal is not waiting for delivery evidence' });
  return json(202, { status: 'accepted' });
}
