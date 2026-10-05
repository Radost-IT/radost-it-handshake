import { describe, expect, it } from 'vitest';
import { defenseByCategory, type ScenarioResult } from './report';

const result = (attack: string | null, passed: boolean): ScenarioResult => ({
  name: `${String(attack)}-${String(passed)}`,
  kind: 'verification',
  description: 'A case',
  attack,
  passed,
  outcome: passed ? 'VOID' : 'CAPTURE',
  inputTokens: 0,
  outputTokens: 0,
});

describe('defenseByCategory', () => {
  it('counts held attacks per category and leaves out baseline cases', () => {
    const scenarios = [
      result('prompt-injection', true),
      result(null, false),
      result('prompt-injection', false),
      result('swapped-item', true),
    ];

    expect(defenseByCategory(scenarios)).toEqual([
      { category: 'prompt-injection', held: 1, total: 2, defenseRate: 50 },
      { category: 'swapped-item', held: 1, total: 1, defenseRate: 100 },
    ]);
  });

  it('returns no categories when no scenario is an attack', () => {
    expect(defenseByCategory([result(null, true)])).toEqual([]);
  });
});
