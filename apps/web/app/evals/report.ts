import { z } from 'zod';

const scenarioResultSchema = z.object({
  name: z.string(),
  kind: z.enum(['negotiation', 'verification']),
  description: z.string(),
  attack: z.string().nullable(),
  passed: z.boolean(),
  outcome: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
});

export const evalReportSchema = z.object({
  generatedAt: z.iso.datetime(),
  models: z.object({ fast: z.string(), smart: z.string() }),
  scenarios: z.array(scenarioResultSchema),
});

export type EvalReport = z.infer<typeof evalReportSchema>;
export type ScenarioResult = z.infer<typeof scenarioResultSchema>;

export interface CategoryDefense {
  category: string;
  held: number;
  total: number;
  /** Share of attack scenarios the agents held, from 0 to 100. */
  defenseRate: number;
}

/** Defense rate per attack category, in the order the categories first appear. */
export function defenseByCategory(scenarios: readonly ScenarioResult[]): CategoryDefense[] {
  const byCategory = new Map<string, { held: number; total: number }>();
  for (const { attack, passed } of scenarios) {
    if (attack === null) continue;
    const counts = byCategory.get(attack) ?? { held: 0, total: 0 };
    byCategory.set(attack, { held: counts.held + Number(passed), total: counts.total + 1 });
  }
  return [...byCategory].map(([category, { held, total }]) => ({
    category,
    held,
    total,
    defenseRate: Math.round((held / total) * 100),
  }));
}
