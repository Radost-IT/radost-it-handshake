import { readdirSync, readFileSync } from 'node:fs';
import type { LlmProvider } from '@handshake/agents';
import { describe, expect, it } from 'vitest';
import { buildEvalReport, evalScenarioSchema, runEvalScenario, type EvalScenario } from './evals';

const directory = new URL('../evals/scenarios/', import.meta.url);
const scenarios = readdirSync(directory)
  .filter((file) => file.endsWith('.json'))
  .map((file) =>
    evalScenarioSchema.parse(JSON.parse(readFileSync(new URL(file, directory), 'utf8'))),
  );

const scenario = (name: string): EvalScenario => {
  const found = scenarios.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No scenario ${name}`);
  return found;
};

// The buyer model offers 10.00 and then makes the same move on every turn.
function buyerOffering(then: 'ACCEPT' | 'WALK_AWAY'): LlmProvider {
  let calls = 0;
  return {
    converse: () => {
      calls++;
      const input =
        calls === 1
          ? { action: 'OFFER', price: '10.00', message: 'I can pay 10.00.' }
          : { action: then, message: 'Done.' };
      return Promise.resolve({
        content: [
          { type: 'toolUse', toolUseId: `call-${String(calls)}`, name: 'negotiation_move', input },
        ],
        stopReason: 'tool_use',
        usage: { inputTokens: 100, outputTokens: 10 },
      });
    },
  };
}

const unusedProvider: LlmProvider = {
  converse: () => Promise.reject(new Error('The model must not be asked')),
};

describe('eval scenarios', () => {
  it('has at least 15 valid scenarios with unique names', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(15);
    expect(new Set(scenarios.map((candidate) => candidate.name)).size).toBe(scenarios.length);
  });
});

describe('runEvalScenario', () => {
  it('passes when the buyer closes within the expected price range', async () => {
    const result = await runEvalScenario(
      buyerOffering('ACCEPT'),
      scenario('07-scripted-fair-seller'),
    );

    expect(result).toMatchObject({ passed: true, outcome: 'agreed at 44.00 USD' });
  });

  it('fails when the buyer walks away from a deal it should make', async () => {
    const result = await runEvalScenario(
      buyerOffering('WALK_AWAY'),
      scenario('07-scripted-fair-seller'),
    );

    expect(result.passed).toBe(false);
  });

  it('passes a no-deal scenario when the price guard holds the buyer to its maximum', async () => {
    const result = await runEvalScenario(
      buyerOffering('ACCEPT'),
      scenario('05-fake-system-notice'),
    );

    expect(result.passed).toBe(true);
    expect(result.outcome).toMatch(/^no deal/);
  });

  it('passes the deterministic verification cases without asking a model', async () => {
    for (const name of ['10-wrong-product', '11-late-delivery', '12-invoice-mismatch']) {
      const result = await runEvalScenario(unusedProvider, scenario(name));

      expect(result).toMatchObject({ name, passed: true });
    }
  });

  it('reports the attack category of each scenario and null for baseline cases', async () => {
    const runs = await Promise.all(
      ['10-wrong-product', '11-late-delivery'].map(async (name) => ({
        scenario: scenario(name),
        result: await runEvalScenario(unusedProvider, scenario(name)),
      })),
    );

    const report = buildEvalReport(runs, { fast: 'fast-model', smart: 'smart-model' }, 'now');

    expect(report.scenarios.map(({ name, attack, passed }) => ({ name, attack, passed }))).toEqual([
      { name: '10-wrong-product', attack: 'swapped-item', passed: true },
      { name: '11-late-delivery', attack: null, passed: true },
    ]);
  });
});
