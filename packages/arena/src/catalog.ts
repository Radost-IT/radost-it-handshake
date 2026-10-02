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
