import { money, type Deal, type SettlementProposal } from '@handshake/core';
import { verifyingDeal } from '@handshake/core/testing';
import { PayPalApiError } from '@handshake/paypal';
import { lastSent, stubPayPalClient, type StubResponse } from '@handshake/paypal/testing';
import { describe, expect, it } from 'vitest';
import { executeSettlement, VoidNotConfirmedError } from './settle';

const now = () => '2026-10-05T00:00:00Z';

const captureProposal: SettlementProposal = {
  action: 'CAPTURE',
  amount: money('42.50', 'USD'),
  evidence: { productId: 'prod-1', deliveredAt: '2026-10-04T09:00:00Z' },
  criteria: [
    { criterionId: 'c1', met: true, confidence: 0.95, rationale: 'Label says 750 ml' },
    { criterionId: 'c2', met: true, confidence: 0.9, rationale: 'Lid is in the photo' },
  ],
  reason: 'Delivery matches the contract',
};

const voidProposal: SettlementProposal = { action: 'VOID', reason: 'Wrong product delivered' };

function captureResponse(status: string): StubResponse {
  return {
    status: 201,
    body: { id: 'capture-1', status, amount: { currency_code: 'USD', value: '42.50' } },
  };
}

async function settle(deal: Deal, proposal: SettlementProposal, responses: StubResponse[]) {
  const { client, sent } = stubPayPalClient(responses);
  const result = await executeSettlement({ paypal: client, now }, deal, proposal, 'verifier');
  return { result, sent };
}

function settledState(result: Awaited<ReturnType<typeof executeSettlement>>) {
  if (!result.approved) throw new Error('Expected an approved settlement');
  return { state: result.deal.state, events: result.events.map((event) => event.type) };
}

describe('executeSettlement', () => {
  it('moves no money when policy rejects the proposal', async () => {
    const { result, sent } = await settle(
      verifyingDeal(),
      { ...captureProposal, amount: money('4250.00', 'USD') },
      [],
    );

    expect(result).toMatchObject({ approved: false, violations: [{ code: 'AMOUNT_MISMATCH' }] });
    expect(sent).toHaveLength(0);
  });

  it('settles the deal with a completed capture of the contract price', async () => {
    const deal = verifyingDeal();
    const { result, sent } = await settle(deal, captureProposal, [captureResponse('COMPLETED')]);

    expect(settledState(result)).toEqual({
      state: 'SETTLED',
      events: ['STATE_CHANGED', 'STATE_CHANGED'],
    });
    expect(result.approved && result.deal.capture).toEqual({
      captureId: 'capture-1',
      status: 'COMPLETED',
      amount: money('42.50', 'USD'),
    });
    expect(lastSent(sent).url).toMatch(/\/v2\/payments\/authorizations\/auth-1\/capture$/);
    expect(lastSent(sent).headers['PayPal-Request-Id']).toBe(`deal-1:capture:${deal.eventCount}`);
  });

  it('keeps a pending capture in CAPTURING until PayPal confirms it', async () => {
    const { result } = await settle(verifyingDeal(), captureProposal, [captureResponse('PENDING')]);

    expect(settledState(result).state).toBe('CAPTURING');
  });

  it('escalates a declined capture', async () => {
    const { result } = await settle(verifyingDeal(), captureProposal, [
      captureResponse('DECLINED'),
    ]);

    expect(settledState(result).state).toBe('ESCALATED');
  });

  it('escalates when PayPal refuses the capture', async () => {
    const { result } = await settle(verifyingDeal(), captureProposal, [
      {
        status: 422,
        body: { debug_id: 'debug-1', details: [{ issue: 'AUTHORIZATION_EXPIRED' }] },
      },
    ]);

    expect(settledState(result).state).toBe('ESCALATED');
    expect(result.approved && result.events.at(-1)).toMatchObject({
      reason: 'PayPal capture failed with HTTP 422 (AUTHORIZATION_EXPIRED)',
    });
  });

  it('lets a PayPal server error propagate so the caller retries', async () => {
    const failure = settle(verifyingDeal(), captureProposal, [
      { status: 500, body: { debug_id: 'debug-2' } },
    ]);

    await expect(failure).rejects.toBeInstanceOf(PayPalApiError);
  });

  it('refuses the deal once the authorization is voided', async () => {
    const deal = verifyingDeal();
    const { result, sent } = await settle(deal, voidProposal, [
      { status: 200, body: { id: 'auth-1', status: 'VOIDED' } },
    ]);

    expect(settledState(result)).toEqual({
      state: 'REFUSED',
      events: ['STATE_CHANGED', 'STATE_CHANGED'],
    });
    expect(lastSent(sent).headers['PayPal-Request-Id']).toBe(`deal-1:void:${deal.eventCount}`);
  });

  it('does not refuse the deal when the void is not confirmed', async () => {
    const failure = settle(verifyingDeal(), voidProposal, [
      { status: 200, body: { id: 'auth-1', status: 'CREATED' } },
    ]);

    await expect(failure).rejects.toBeInstanceOf(VoidNotConfirmedError);
  });

  it('escalates without calling PayPal', async () => {
    const { result, sent } = await settle(
      verifyingDeal(),
      { action: 'ESCALATE', reason: 'Photo is blurry' },
      [],
    );

    expect(settledState(result).state).toBe('ESCALATED');
    expect(sent).toHaveLength(0);
  });
});
