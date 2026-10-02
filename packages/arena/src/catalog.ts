export const attackCategories = [
  'prompt-injection',
  'fake-urgency',
  'bait-and-switch',
  'swapped-item',
  'partial-delivery',
  'platform-impersonation',
  'currency-confusion',
  'split-payment',
] as const;

export type AttackCategory = (typeof attackCategories)[number];

/** Where the challenger's text entered the deal. */
export type AttackChannel = 'listing' | 'message' | 'evidence';
