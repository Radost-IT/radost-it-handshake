import {
  addTurn,
  negotiationStatus,
  type Negotiation,
  type NegotiationParty,
  type NegotiationStatus,
  type NegotiationTurn,
} from '@handshake/core';
import type { TokenUsage } from './llm';
import type { DecidedMove } from './negotiator';

export type NegotiationAgent = (negotiation: Negotiation) => Promise<DecidedMove>;

export interface NegotiationResult {
  negotiation: Negotiation;
  status: Exclude<NegotiationStatus, { status: 'OPEN' }>;
  usage: TokenUsage;
}

/**
 * Lets the buyer and the seller take turns until one accepts, one walks away,
 * or the turn cap ends the negotiation. `onTurn` runs after every move, so the
 * caller can store and stream it before the next model call.
 */
export async function runNegotiation(
  start: Negotiation,
  agents: Record<NegotiationParty, NegotiationAgent>,
  options: { now: () => string; onTurn: (turn: NegotiationTurn) => Promise<void> },
): Promise<NegotiationResult> {
  let negotiation = start;
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  for (;;) {
    const status = negotiationStatus(negotiation);
    if (status.status !== 'OPEN') return { negotiation, status, usage };
    const party = status.nextParty;
    const decided = await agents[party](negotiation);
    usage.inputTokens += decided.usage.inputTokens;
    usage.outputTokens += decided.usage.outputTokens;
    const turn: NegotiationTurn = { party, move: decided.move, at: options.now() };
    negotiation = addTurn(negotiation, turn);
    await options.onTurn(turn);
  }
}
