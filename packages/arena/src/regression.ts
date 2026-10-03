import { z } from 'zod';
import { attackCategories, type AttackCategory, type AttackChannel } from './catalog';
import type { Loophole } from './progression';

export const regressionCaseSchema = z.object({
  attemptId: z.string().min(1),
  category: z.enum(attackCategories),
  channel: z.enum(['listing', 'message', 'evidence']),
  attackText: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  /** What the judge saw the agents do wrong, so a fix knows what to block. */
  judgeRationale: z.string().min(1),
  foundBy: z.object({ challengerId: z.string().min(1), handle: z.string().min(1) }),
  foundAt: z.iso.datetime({ offset: true }),
  /** Every case must hold once the defense is fixed. */
  expected: z.literal('held'),
});

export type RegressionCase = z.infer<typeof regressionCaseSchema>;

export class NotARegressionError extends Error {
  override name = 'NotARegressionError';
}

/**
 * Turns a judged loophole into a regression case. Near-duplicates are refused:
 * the case they repeat already covers them.
 */
export function buildRegressionCase(input: {
  attemptId: string;
  category: AttackCategory;
  channel: AttackChannel;
  attackText: string;
  loophole: Loophole;
  judgeRationale: string;
  foundBy: RegressionCase['foundBy'];
  foundAt: string;
}): RegressionCase {
  const { loophole, ...attempt } = input;
  if (loophole.nearDuplicate) {
    throw new NotARegressionError(`Attempt ${input.attemptId} repeats a known loophole`);
  }
  return regressionCaseSchema.parse({ ...attempt, severity: loophole.severity, expected: 'held' });
}

/** The file name in `evals/regressions/`. Sorting by name lists cases oldest first. */
export function regressionFileName(regression: RegressionCase): string {
  return `${regression.foundAt.slice(0, 10)}-${regression.category}-${regression.attemptId}.json`;
}
