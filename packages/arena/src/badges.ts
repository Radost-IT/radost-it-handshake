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
    id: 'eureka',
    name: 'Eureka',
    howToEarn: 'Find your first loophole',
    isUnlocked: (stats: ChallengerStats) => stats.loopholes >= 1,
  },
  {
    id: 'trailblazer',
    name: 'Trailblazer',
    howToEarn: 'Be the first challenger to find a loophole in a category',
    isUnlocked: (stats: ChallengerStats) => stats.firstLoopholeCategories >= 1,
  },
  {
    id: 'map-maker',
    name: 'Map Maker',
    howToEarn: `Try all ${attackCategories.length} attack categories`,
    isUnlocked: (stats: ChallengerStats) =>
      attackCategories.every((category) => stats.categoriesTried.includes(category)),
  },
  {
    id: 'wordsmith',
    name: 'Wordsmith',
    howToEarn: 'Find a loophole through listing or message text',
    isUnlocked: (stats: ChallengerStats) => stats.textLoopholes >= 1,
  },
  {
    id: 'sharp-eye',
    name: 'Sharp Eye',
    howToEarn: 'Find a loophole through delivery evidence',
    isUnlocked: (stats: ChallengerStats) => stats.evidenceLoopholes >= 1,
  },
  {
    id: 'never-give-up',
    name: 'Never Give Up',
    howToEarn: 'Keep going through ten held attempts in a row',
    isUnlocked: (stats: ChallengerStats) => stats.longestHeldStreak >= 10,
  },
  {
    id: 'shield-builder',
    name: 'Shield Builder',
    howToEarn: 'Have your loophole become a regression test that now holds',
    isUnlocked: (stats: ChallengerStats) => stats.regressionsHolding >= 1,
  },
  {
    id: 'daily-regular',
    name: 'Daily Regular',
    howToEarn: 'Play the daily challenge on five different days',
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
