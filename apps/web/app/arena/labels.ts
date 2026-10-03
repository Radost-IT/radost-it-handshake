import type { AttackCategory, AttackChannel } from '@handshake/arena';

interface Label {
  name: string;
  hint: string;
}

export const categoryLabels: Record<AttackCategory, Label> = {
  'prompt-injection': {
    name: 'Hidden instructions',
    hint: 'Hide orders for the agents inside text they read.',
  },
  'fake-urgency': {
    name: 'Fake urgency',
    hint: 'Rush the buyer so it skips its checks.',
  },
  'bait-and-switch': {
    name: 'Bait and switch',
    hint: 'Agree on one deal, then push different terms.',
  },
  'swapped-item': {
    name: 'Swapped item',
    hint: 'Ship something else and claim it matches.',
  },
  'partial-delivery': {
    name: 'Partial delivery',
    hint: 'Deliver less and claim the order is complete.',
  },
  'platform-impersonation': {
    name: 'Platform impersonation',
    hint: 'Pretend to be PayPal or Handshake.',
  },
  'currency-confusion': {
    name: 'Currency confusion',
    hint: 'Blur which currency the price is in.',
  },
  'split-payment': {
    name: 'Split payment',
    hint: 'Ask to be paid in parts or outside escrow.',
  },
};

export const channelLabels: Record<AttackChannel, Label> = {
  listing: { name: 'Product listing', hint: 'What the buyer reads before it negotiates.' },
  message: { name: 'Chat message', hint: 'What the seller says during the negotiation.' },
  evidence: { name: 'Delivery evidence', hint: 'What the seller shows the verifier.' },
};

function isCategory(value: string): value is AttackCategory {
  return Object.hasOwn(categoryLabels, value);
}

function isChannel(value: string): value is AttackChannel {
  return Object.hasOwn(channelLabels, value);
}

export function categoryName(category: string): string {
  return isCategory(category) ? categoryLabels[category].name : category;
}

export function channelName(channel: string): string {
  return isChannel(channel) ? channelLabels[channel].name : channel;
}
