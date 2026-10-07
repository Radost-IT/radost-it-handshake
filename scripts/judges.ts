import { z } from 'zod';

const JUDGE_COUNT = 5;

/** judge-1@<domain> to judge-5@<domain>, or undefined when the domain makes no valid email. */
export function judgeEmails(domain: string | undefined): string[] | undefined {
  const emails = z
    .array(z.email())
    .safeParse(
      Array.from({ length: JUDGE_COUNT }, (_, index) =>
        `judge-${String(index + 1)}@${domain ?? ''}`.toLowerCase(),
      ),
    );
  return emails.success ? emails.data : undefined;
}
