import { settlementProposalSchema } from '@handshake/core';
import type { WaitSignal } from '@handshake/store';
import { resumeLifecycle, type ResumeContext } from '@handshake/workflows/resume-lifecycle';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { z, type ZodType } from 'zod';
import { refuseDealAccess } from './deal-auth';
import { json, parseJson } from './http';

export interface DealRequest {
  dealId: string;
  /** The Authorization header: the developer's API key or the deal access token. */
  authorization: string | undefined;
  body: string;
}

const purchaseApprovalSchema = z.object({ approved: z.boolean() });

/** The buyer approves or declines a price above their approval threshold. */
export function approvePurchase(
  context: ResumeContext,
  request: DealRequest,
): Promise<APIGatewayProxyStructuredResultV2> {
  return resumeWithDecision(context, request, 'purchase-approval', purchaseApprovalSchema);
}

/**
 * The buyer decides an escalated deal. The decision is only a proposal: the
 * lifecycle checks it against policy before any money moves.
 */
export function decideEscalation(
  context: ResumeContext,
  request: DealRequest,
): Promise<APIGatewayProxyStructuredResultV2> {
  return resumeWithDecision(context, request, 'human-decision', settlementProposalSchema);
}

async function resumeWithDecision(
  context: ResumeContext,
  request: DealRequest,
  signal: WaitSignal,
  decisionSchema: ZodType,
): Promise<APIGatewayProxyStructuredResultV2> {
  const refusal = await refuseDealAccess(context.table, request.dealId, request.authorization);
  if (refusal) return refusal;
  const decision = decisionSchema.safeParse(parseJson(request.body));
  if (!decision.success) return json(400, { error: 'The decision is not valid' });

  const resumed = await resumeLifecycle(context, request.dealId, signal, decision.data);
  if (!resumed) return json(409, { error: 'The deal is not waiting for this decision' });
  return json(202, { status: 'accepted' });
}
