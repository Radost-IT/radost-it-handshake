import { randomUUID } from 'node:crypto';
import { loadConfig } from '@handshake/config';
import { money } from '@handshake/core';
import { createPayPalClient, PayPalApiError } from '@handshake/paypal';
import { payBounty } from '@handshake/settlement';

const config = await loadConfig();
const client = createPayPalClient(config.paypal);
const limits = {
  maxBounty: money(config.limits.maxBounty, 'USD'),
  dailyBudget: money(config.limits.dailyBountyBudget, 'USD'),
  recipientEmail: config.arena.recipientEmail,
};

try {
  const result = await payBounty(
    client,
    {
      attemptId: `probe-${randomUUID()}`,
      amount: money('1.00', 'USD'),
      recipientEmail: limits.recipientEmail,
      reason: 'Handshake payout probe',
    },
    limits,
    money('0', 'USD'),
  );
  if (!result.approved) {
    console.error(
      `Policy refused the probe bounty: ${result.violations.map((v) => v.message).join('; ')}`,
    );
    process.exit(1);
  }
  console.log(`Payout batch ${result.payout.batchId}: ${result.payout.status}`);
  console.log(
    'Check the arena recipient sandbox account for 1.00 USD, see INSTRUCTIONS.md [I-12].',
  );
} catch (error) {
  if (error instanceof PayPalApiError) {
    console.error(`${error.message}, debug_id ${error.debugId ?? 'none'}`);
    process.exit(1);
  }
  throw error;
}
