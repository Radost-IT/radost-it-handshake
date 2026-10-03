import { money, type BountyProposal } from '@handshake/core';
import { stubPayPalClient } from '@handshake/paypal/testing';
import { describe, expect, it } from 'vitest';
import { payBounty } from './bounty';

const limits = {
  maxBounty: money('5.00', 'USD'),
  dailyBudget: money('20.00', 'USD'),
  recipientEmail: 'arena@example.com',
};

const proposal: BountyProposal = {
  attemptId: 'attempt-1',
  amount: money('3.00', 'USD'),
  recipientEmail: 'arena@example.com',
  reason: 'Loophole found: swapped-item evidence',
};

const createdBatch = {
  status: 201,
  body: { batch_header: { payout_batch_id: 'BATCH-1', batch_status: 'PENDING' } },
};

describe('payBounty', () => {
  it('pays an approved bounty', async () => {
    const { client, sent } = stubPayPalClient([createdBatch]);

    const result = await payBounty(client, proposal, limits, money('0', 'USD'));

    expect(result).toEqual({ approved: true, payout: { batchId: 'BATCH-1', status: 'PENDING' } });
    expect(sent).toHaveLength(1);
  });

  it('sends nothing to PayPal when policy refuses the bounty', async () => {
    const { client, sent } = stubPayPalClient([]);

    const result = await payBounty(
      client,
      { ...proposal, recipientEmail: 'someone@example.com' },
      limits,
      money('18.00', 'USD'),
    );

    expect(result.approved).toBe(false);
    expect(!result.approved && result.violations.map((violation) => violation.code)).toEqual([
      'RECIPIENT_NOT_ALLOWED',
      'DAILY_BOUNTY_BUDGET_EXCEEDED',
    ]);
    expect(sent).toHaveLength(0);
  });
});
