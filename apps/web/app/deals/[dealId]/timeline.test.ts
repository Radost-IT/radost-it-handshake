import { describe, expect, it } from 'vitest';
import type { DealEvent } from '../api';
import { escrowSteps, paypalActivity } from './timeline';

function changed(seq: number, from: string, to: string): DealEvent {
  return {
    type: 'STATE_CHANGED',
    seq,
    at: `2026-10-05T10:0${seq}:00.000Z`,
    from,
    to,
    reason: 'test',
  };
}

const settledPath: DealEvent[] = [
  { type: 'CREATED', seq: 1, at: '2026-10-05T10:01:00.000Z' },
  changed(2, 'DRAFT', 'NEGOTIATING'),
  changed(3, 'NEGOTIATING', 'AGREED'),
  changed(4, 'AGREED', 'AUTHORIZING'),
  changed(5, 'AUTHORIZING', 'IN_ESCROW'),
  changed(6, 'IN_ESCROW', 'AWAITING_DELIVERY'),
  changed(7, 'AWAITING_DELIVERY', 'VERIFYING'),
  changed(8, 'VERIFYING', 'CAPTURING'),
  changed(9, 'CAPTURING', 'SETTLED'),
];

describe('escrowSteps', () => {
  it('marks every step done for a settled deal', () => {
    const steps = escrowSteps('SETTLED', settledPath);

    expect(steps.map((step) => step.status)).toEqual(['done', 'done', 'done', 'done']);
    expect(steps.at(-1)).toMatchObject({
      label: 'Payment captured',
      at: '2026-10-05T10:09:00.000Z',
    });
  });

  it('points at the next step while the deal waits', () => {
    const steps = escrowSteps('AWAITING_DELIVERY', settledPath.slice(0, 6));

    expect(steps.map((step) => step.status)).toEqual(['done', 'done', 'current', 'pending']);
  });

  it('ends a refused deal on the void step', () => {
    const events = [
      ...settledPath.slice(0, 7),
      changed(8, 'VERIFYING', 'VOIDING'),
      changed(9, 'VOIDING', 'REFUSED'),
    ];

    const steps = escrowSteps('REFUSED', events);

    expect(steps.at(-1)).toMatchObject({ label: 'Authorization voided', status: 'done' });
  });

  it('shows where an abandoned deal stopped', () => {
    const events = [...settledPath.slice(0, 2), changed(3, 'NEGOTIATING', 'ABANDONED')];

    const steps = escrowSteps('ABANDONED', events);

    expect(steps.map((step) => step.status)).toEqual(['stopped', 'pending', 'pending', 'pending']);
  });
});

describe('paypalActivity', () => {
  it('merges calls and webhooks by time', () => {
    const activity = paypalActivity(
      [
        {
          at: '2026-10-05T10:00:00.000Z',
          operation: 'authorize',
          requestId: 'deal-1:authorize:1',
          statusCode: 201,
          debugId: 'abc',
        },
        {
          at: '2026-10-05T10:02:00.000Z',
          operation: 'capture',
          requestId: 'deal-1:capture:1',
          statusCode: 201,
          debugId: 'def',
        },
      ],
      [
        {
          at: '2026-10-05T10:01:00.000Z',
          eventId: 'WH-1',
          eventType: 'PAYMENT.AUTHORIZATION.CREATED',
          resourceId: 'auth-1',
        },
      ],
    );

    expect(activity.map((entry) => entry.kind)).toEqual(['call', 'webhook', 'call']);
  });
});
