import { describe, expect, it } from 'vitest';
import { InvalidChallengeDateError, pickDailyChallenge } from './daily-challenge';

const templates = ['kettle', 'headphones', 'backpack', 'lamp', 'chair'] as const;

describe('pickDailyChallenge', () => {
  it('picks the same template for the same date', () => {
    expect(pickDailyChallenge('2026-10-02', templates)).toBe(
      pickDailyChallenge('2026-10-02', templates),
    );
  });

  it('uses every template over a month', () => {
    const picks = new Set(
      Array.from({ length: 31 }, (_, day) =>
        pickDailyChallenge(`2026-10-${String(day + 1).padStart(2, '0')}`, templates),
      ),
    );

    expect(picks.size).toBe(templates.length);
  });

  it('rejects anything but a plain date', () => {
    expect(() => pickDailyChallenge('2026-10-02T00:00:00Z', templates)).toThrow(
      InvalidChallengeDateError,
    );
    expect(() => pickDailyChallenge('2026-13-40', templates)).toThrow(InvalidChallengeDateError);
  });
});
