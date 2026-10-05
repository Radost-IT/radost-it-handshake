import { describe, expect, it } from 'vitest';
import { nextPathFrom } from './next-path';

describe('nextPathFrom', () => {
  it('returns a known page', () => {
    expect(nextPathFrom('?next=/arena')).toBe('/arena');
  });

  it('opens the console for a missing or unknown page', () => {
    expect(nextPathFrom('')).toBe('/console');
    expect(nextPathFrom('?next=https://evil.example')).toBe('/console');
    expect(nextPathFrom('?next=//evil.example')).toBe('/console');
  });
});
