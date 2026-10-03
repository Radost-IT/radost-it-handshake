import { offensiveWords } from './offensive-words';

export type HandleCheck = { valid: true; handle: string } | { valid: false; reason: string };

const MIN_LENGTH = 3;
const MAX_LENGTH = 20;

// Names that could pass for the platform or its staff.
const reservedWords = ['admin', 'handshake', 'moderator', 'paypal', 'radost', 'support', 'system'];

const lookalikes: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  $: 's',
  '@': 'a',
};

function normalize(handle: string): string {
  return handle.toLowerCase().replace(/[^a-z]/g, (char) => lookalikes[char] ?? '');
}

/** Checks a handle a challenger picked. Handles are public, so they must suit any age. */
export function validateHandle(input: string): HandleCheck {
  const handle = input.trim();
  if (handle.length < MIN_LENGTH || handle.length > MAX_LENGTH) {
    return { valid: false, reason: `Use ${MIN_LENGTH} to ${MAX_LENGTH} characters` };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(handle)) {
    return {
      valid: false,
      reason: 'Use letters, numbers, - and _, and start with a letter or number',
    };
  }
  const plain = normalize(handle);
  if (reservedWords.some((word) => plain.includes(word))) {
    return { valid: false, reason: 'This handle is reserved' };
  }
  if (offensiveWords.some((word) => plain.includes(word))) {
    return { valid: false, reason: 'Pick a handle that suits all ages' };
  }
  return { valid: true, handle };
}
