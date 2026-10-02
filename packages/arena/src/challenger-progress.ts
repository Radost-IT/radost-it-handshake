import type { ChallengerStats } from './badges';
import type { AttackCategory, AttackChannel } from './catalog';
import { xpForAttempt, type AttemptOutcome } from './progression';

/** Everything about a challenger that one attempt can change. */
export interface ChallengerProgress {
  xp: number;
  stats: ChallengerStats;
  currentHeldStreak: number;
  /** XP from the most recent daily challenge day, for the daily leaderboard. */
  daily: { date: string; xp: number } | null;
}

export interface JudgedAttempt {
  category: AttackCategory;
  channel: AttackChannel;
  outcome: AttemptOutcome;
  /** No one had found a loophole in this category before. */
  firstInCategory: boolean;
  /** The date of the daily challenge this attempt played, if any. */
  dailyChallengeDate: string | null;
}

export const newChallengerProgress: ChallengerProgress = {
  xp: 0,
  stats: {
    loopholes: 0,
    firstLoopholeCategories: 0,
    categoriesTried: [],
    textLoopholes: 0,
    evidenceLoopholes: 0,
    longestHeldStreak: 0,
    regressionsHolding: 0,
    dailyChallengeDays: 0,
  },
  currentHeldStreak: 0,
  daily: null,
};

export function applyAttempt(
  progress: ChallengerProgress,
  attempt: JudgedAttempt,
): { progress: ChallengerProgress; xpGained: number } {
  const xpGained = xpForAttempt(attempt.outcome);
  const loophole = attempt.outcome.result === 'loophole';
  const { stats } = progress;
  const currentHeldStreak = loophole ? 0 : progress.currentHeldStreak + 1;
  const playsNewDailyDay =
    attempt.dailyChallengeDate !== null && attempt.dailyChallengeDate !== progress.daily?.date;

  return {
    xpGained,
    progress: {
      xp: progress.xp + xpGained,
      currentHeldStreak,
      daily: dailyAfter(progress.daily, attempt.dailyChallengeDate, xpGained),
      stats: {
        loopholes: stats.loopholes + Number(loophole),
        firstLoopholeCategories:
          stats.firstLoopholeCategories + Number(loophole && attempt.firstInCategory),
        categoriesTried: stats.categoriesTried.includes(attempt.category)
          ? stats.categoriesTried
          : [...stats.categoriesTried, attempt.category],
        textLoopholes: stats.textLoopholes + Number(loophole && attempt.channel !== 'evidence'),
        evidenceLoopholes:
          stats.evidenceLoopholes + Number(loophole && attempt.channel === 'evidence'),
        longestHeldStreak: Math.max(stats.longestHeldStreak, currentHeldStreak),
        regressionsHolding: stats.regressionsHolding,
        dailyChallengeDays: stats.dailyChallengeDays + Number(playsNewDailyDay),
      },
    },
  };
}

function dailyAfter(
  daily: ChallengerProgress['daily'],
  dailyChallengeDate: string | null,
  xpGained: number,
): ChallengerProgress['daily'] {
  if (dailyChallengeDate === null) return daily;
  if (daily?.date === dailyChallengeDate) return { date: daily.date, xp: daily.xp + xpGained };
  return { date: dailyChallengeDate, xp: xpGained };
}
