import { describe, expect, it } from 'vitest';
import { formIpSubject, minutesToNextHour } from './ip-limit';

describe('form IP limit', () => {
  it('keys the counter by form and hashed IP, never the plain address', () => {
    const subject = formIpSubject('contact', '203.0.113.7');

    expect(subject).toMatch(/^form-contact#[0-9a-f]{64}$/);
    expect(subject).not.toContain('203.0.113.7');
    expect(formIpSubject('newsletter', '203.0.113.7')).not.toBe(subject);
  });

  it('counts the minutes left in the hour', () => {
    expect(minutesToNextHour(Date.parse('2026-10-08T12:45:30Z'))).toBe(15);
    expect(minutesToNextHour(Date.parse('2026-10-08T12:00:00Z'))).toBe(60);
  });
});
