export { checkAttackText, MAX_ATTACK_LENGTH, type AttackTextCheck } from './attack-text';
export {
  badges,
  newlyUnlocked,
  unlockedBadges,
  type BadgeId,
  type ChallengerStats,
} from './badges';
export {
  attackCategories,
  dealTemplates,
  pickDealTemplate,
  type AttackCategory,
  type AttackChannel,
  type DealTemplate,
} from './catalog';
export {
  applyAttempt,
  newChallengerProgress,
  type ChallengerProgress,
  type JudgedAttempt,
} from './challenger-progress';
export { InvalidChallengeDateError, pickDailyChallenge } from './daily-challenge';
export { validateHandle, type HandleCheck } from './handle';
export {
  buildRegressionCase,
  NotARegressionError,
  regressionCaseSchema,
  regressionFileName,
  type RegressionCase,
} from './regression';
export { scoreAttempt, type AttemptScore, type ScoringContext } from './scoring';
export {
  rankForXp,
  rankProgress,
  ranks,
  xpForAttempt,
  type AttemptOutcome,
  type Loophole,
  type Rank,
  type RankProgress,
  type Severity,
} from './progression';
