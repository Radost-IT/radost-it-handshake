import { attackCategories, type AttackCategory } from './catalog';

/** What badges are computed from. Kept on the challenger record. */
export interface ChallengerStats {
  loopholes: number;
  /** Categories in which this challenger found the first loophole of anyone. */
  firstLoopholeCategories: number;
  categoriesTried: readonly AttackCategory[];
  /** Loopholes found through listing or message text. */
  textLoopholes: number;
  evidenceLoopholes: number;
  longestHeldStreak: number;
  regressionsHolding: number;
  dailyChallengeDays: number;
}

export const badges = [
  {
    id: 'first-breach',
    name: 'First Breach',
    howToEarn: 'Find your first breach',
    isUnlocked: (stats: ChallengerStats) => stats.loopholes >= 1,
  },
  {
    id: 'first-in-category',
    name: 'First in Category',
    howToEarn: 'Be the first researcher to breach an attack category',
    isUnlocked: (stats: ChallengerStats) => stats.firstLoopholeCategories >= 1,
  },
  {
    id: 'full-coverage',
    name: 'Full Coverage',
    howToEarn: `Test all ${attackCategories.length} attack categories`,
    isUnlocked: (stats: ChallengerStats) =>
      attackCategories.every((category) => stats.categoriesTried.includes(category)),
  },
  {
    id: 'text-channel',
    name: 'Text Channel',
    howToEarn: 'Breach the agents through listing or message text',
    isUnlocked: (stats: ChallengerStats) => stats.textLoopholes >= 1,
  },
  {
    id: 'evidence-channel',
    name: 'Evidence Channel',
    howToEarn: 'Breach the verifier through delivery evidence',
    isUnlocked: (stats: ChallengerStats) => stats.evidenceLoopholes >= 1,
  },
  {
    id: 'sustained-testing',
    name: 'Sustained Testing',
    howToEarn: 'Keep testing through ten held attempts in a row',
    isUnlocked: (stats: ChallengerStats) => stats.longestHeldStreak >= 10,
  },
  {
    id: 'regression-author',
    name: 'Regression Author',
    howToEarn: 'Have your breach become a regression test that now holds',
    isUnlocked: (stats: ChallengerStats) => stats.regressionsHolding >= 1,
  },
  {
    id: 'daily-target',
    name: 'Daily Target',
    howToEarn: 'Test the daily target on five different days',
    isUnlocked: (stats: ChallengerStats) => stats.dailyChallengeDays >= 5,
  },
] as const;

export type BadgeId = (typeof badges)[number]['id'];

export function unlockedBadges(stats: ChallengerStats): BadgeId[] {
  return badges.filter((badge) => badge.isUnlocked(stats)).map((badge) => badge.id);
}

/** Badges to announce after an attempt changed the stats. */
export function newlyUnlocked(before: ChallengerStats, after: ChallengerStats): BadgeId[] {
  const had = unlockedBadges(before);
  return unlockedBadges(after).filter((id) => !had.includes(id));
}
