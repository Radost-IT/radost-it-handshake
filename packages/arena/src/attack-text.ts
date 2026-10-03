import { offensiveWords } from './offensive-words';

export const MAX_ATTACK_LENGTH = 2000;

// Long runs of one character only add tokens; no trick needs them.
const REPEATED_CHARACTER = /(.)\1{29,}/su;
// Line breaks and tabs shape a fake invoice or message; other control characters only hide text.
const LAYOUT_CHARACTERS = /[\r\n\t]/g;
const CONTROL_CHARACTER = /\p{Cc}/u;

export type AttackTextCheck = { valid: true; text: string } | { valid: false; reason: string };

/**
 * The basic abuse filter for a challenger's attack. Attacks are shown on
 * public pages, so they must suit any age. Tricks such as fake instructions,
 * links and urgency are the point of the arena and pass.
 */
export function checkAttackText(input: string): AttackTextCheck {
  const text = input.trim();
  if (text.length === 0) return { valid: false, reason: 'Write your attack first' };
  if (text.length > MAX_ATTACK_LENGTH) {
    return { valid: false, reason: `Keep your attack under ${MAX_ATTACK_LENGTH} characters` };
  }
  if (CONTROL_CHARACTER.test(text.replace(LAYOUT_CHARACTERS, ''))) {
    return { valid: false, reason: 'Remove the hidden control characters' };
  }
  if (REPEATED_CHARACTER.test(text)) {
    return { valid: false, reason: 'Remove the long runs of the same character' };
  }
  const words = text.toLowerCase().split(/[^a-z]+/);
  if (words.some((word) => offensiveWords.includes(word))) {
    return { valid: false, reason: 'Keep your attack suitable for all ages' };
  }
  return { valid: true, text };
}
