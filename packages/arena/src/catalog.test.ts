import { compareMoney, hasSameCurrency } from '@handshake/core';
import { describe, expect, it } from 'vitest';
import { dealTemplates, pickDealTemplate } from './catalog';
import { pickDailyChallenge } from './daily-challenge';

describe('dealTemplates', () => {
  it('have unique IDs and product IDs', () => {
    expect(new Set(dealTemplates.map((template) => template.id)).size).toBe(dealTemplates.length);
    expect(new Set(dealTemplates.map((template) => template.listing.productId)).size).toBe(
      dealTemplates.length,
    );
  });

  it.each(dealTemplates)('$id leaves room for an honest deal', (template) => {
    const { seller, listing, buyer } = template;

    expect(hasSameCurrency(seller.floorPrice, buyer.maxPrice)).toBe(true);
    expect(hasSameCurrency(listing.listPrice, buyer.maxPrice)).toBe(true);
    expect(compareMoney(seller.floorPrice, buyer.maxPrice)).toBeLessThan(0);
    expect(compareMoney(buyer.maxPrice, listing.listPrice)).toBeLessThanOrEqual(0);
  });
});

describe('pickDealTemplate', () => {
  it('gives every daily challenge attempt the template of the day', () => {
    const date = '2026-10-03';

    expect(pickDealTemplate({ id: 'a1', dailyChallengeDate: date })).toBe(
      pickDailyChallenge(date, dealTemplates),
    );
    expect(pickDealTemplate({ id: 'a2', dailyChallengeDate: date })).toBe(
      pickDailyChallenge(date, dealTemplates),
    );
  });

  it('keeps the same attempt on the same template', () => {
    expect(pickDealTemplate({ id: 'attempt-7', dailyChallengeDate: null })).toBe(
      pickDealTemplate({ id: 'attempt-7', dailyChallengeDate: null }),
    );
  });

  it('spreads other attempts over the templates', () => {
    const picks = new Set(
      Array.from({ length: 50 }, (_, index) =>
        pickDealTemplate({ id: `attempt-${String(index)}`, dailyChallengeDate: null }),
      ),
    );

    expect(picks.size).toBe(dealTemplates.length);
  });
});
