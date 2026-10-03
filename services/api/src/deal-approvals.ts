import { settlementProposalSchema } from '@handshake/core';
import { hasDealAccess, type WaitSignal } from '@handshake/store';
import { resumeLifecycle, type ResumeContext } from '@handshake/workflows/resume-lifecycle';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { z, type ZodType } from 'zod';
import { hashToken, json, parseJson } from './http';

export type DealApiContext = ResumeContext;

export interface DealRequest {
  dealId: string;
  /** The Authorization header, which carries the deal access token as a Bearer token. */
  authorization: string | undefined;
  body: string;
}

const purchaseApprovalSchema = z.object({ approved: z.boolean() });

/** The buyer approves or declines a price above their approval threshold. */
export function approvePurchase(
  context: DealApiContext,
  request: DealRequest,
): Promise<APIGatewayProxyStructuredResultV2> {
  return resumeWithDecision(context, request, 'purchase-approval', purchaseApprovalSchema);
}

/**
 * The buyer decides an escalated deal. The decision is only a proposal: the
 * lifecycle checks it against policy before any money moves.
 */
export function decideEscalation(
  context: DealApiContext,
  request: DealRequest,
): Promise<APIGatewayProxyStructuredResultV2> {
  return resumeWithDecision(context, request, 'human-decision', settlementProposalSchema);
}

async function resumeWithDecision(
  context: DealApiContext,
  request: DealRequest,
  signal: WaitSignal,
  decisionSchema: ZodType,
): Promise<APIGatewayProxyStructuredResultV2> {
  const token = readBearerToken(request.authorization);
  if (!token) return json(401, { error: 'Send the deal access token' });
  // A wrong token and an unknown deal look the same, so tokens cannot be used to find deals.
  if (!(await hasDealAccess(context.table, request.dealId, hashToken(token)))) {
    return json(404, { error: 'Deal not found' });
  }
  const decision = decisionSchema.safeParse(parseJson(request.body));
  if (!decision.success) return json(400, { error: 'The decision is not valid' });

  const resumed = await resumeLifecycle(context, request.dealId, signal, decision.data);
  if (!resumed) return json(409, { error: 'The deal is not waiting for this decision' });
  return json(202, { status: 'accepted' });
}

function readBearerToken(authorization: string | undefined): string | undefined {
  const match = /^Bearer (\S+)$/.exec(authorization ?? '');
  return match?.[1];
}
