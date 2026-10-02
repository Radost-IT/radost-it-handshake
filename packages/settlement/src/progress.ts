import { transitionDeal, type Deal, type DealEvent, type DealTransition } from '@handshake/core';

/** A deal and the events produced so far, waiting to be persisted together. */
export interface Progress {
  deal: Deal;
  events: DealEvent[];
}

export function advance(
  progress: Progress,
  transition: DealTransition,
  at: string,
  reason: string,
): Progress {
  const change = transitionDeal(progress.deal, transition, at, reason);
  return { deal: change.deal, events: [...progress.events, change.event] };
}
