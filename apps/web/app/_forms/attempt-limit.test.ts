import { describe, expect, it } from 'vitest';
import {
  FORM_WINDOW_MS,
  MAX_FORM_ATTEMPTS,
  checkAttemptLimit,
  recordAttempt,
  retryAfterMinutes,
  sealAttemptWindow,
} from './attempt-limit';

const SECRET = 'a'.repeat(64);
const NOW = 1_800_000_000_000;

describe('attempt limit', () => {
  it('starts with no attempts', () => {
    const limit = checkAttemptLimit({
      secret: SECRET,
      form: 'contact',
      ip: '10.0.0.1',
      cookie: undefined,
      now: NOW,
    });

    expect(limit).toEqual({ count: 0, startedAt: NOW, blocked: false, retryAfterMs: 0 });
  });

  it('blocks after the maximum attempts from the same IP without a cookie', () => {
    const ip = '10.0.0.2';
    for (let attempt = 0; attempt < MAX_FORM_ATTEMPTS; attempt++) {
      const limit = checkAttemptLimit({
        secret: SECRET,
        form: 'contact',
        ip,
        cookie: undefined,
        now: NOW,
      });
      recordAttempt({ form: 'contact', ip, limit, now: NOW });
    }

    const limit = checkAttemptLimit({
      secret: SECRET,
      form: 'contact',
      ip,
      cookie: undefined,
      now: NOW + 1000,
    });

    expect(limit.blocked).toBe(true);
    expect(limit.retryAfterMs).toBe(FORM_WINDOW_MS - 1000);
  });

  it('blocks a full cookie from a new IP', () => {
    const cookie = sealAttemptWindow(SECRET, { count: MAX_FORM_ATTEMPTS, startedAt: NOW });

    const limit = checkAttemptLimit({
      secret: SECRET,
      form: 'contact',
      ip: '10.0.0.3',
      cookie,
      now: NOW,
    });

    expect(limit.blocked).toBe(true);
  });

  it('ignores a cookie with a forged count', () => {
    const sealed = sealAttemptWindow(SECRET, { count: 4, startedAt: NOW });
    const forged = sealed.replace(/^4\./, '0.');

    const limit = checkAttemptLimit({
      secret: SECRET,
      form: 'contact',
      ip: '10.0.0.4',
      cookie: forged,
      now: NOW,
    });

    expect(limit.count).toBe(0);
  });

  it('opens again once the window has passed', () => {
    const cookie = sealAttemptWindow(SECRET, { count: MAX_FORM_ATTEMPTS, startedAt: NOW });

    const limit = checkAttemptLimit({
      secret: SECRET,
      form: 'contact',
      ip: '10.0.0.5',
      cookie,
      now: NOW + FORM_WINDOW_MS,
    });

    expect(limit.blocked).toBe(false);
  });

  it('counts each form separately', () => {
    const ip = '10.0.0.6';
    const limit = checkAttemptLimit({
      secret: SECRET,
      form: 'contact',
      ip,
      cookie: undefined,
      now: NOW,
    });
    recordAttempt({ form: 'contact', ip, limit, now: NOW });

    const newsletter = checkAttemptLimit({
      secret: SECRET,
      form: 'newsletter',
      ip,
      cookie: undefined,
      now: NOW,
    });

    expect(newsletter.count).toBe(0);
  });

  it('keeps the first attempt time when recording later attempts', () => {
    const ip = '10.0.0.7';
    const first = checkAttemptLimit({
      secret: SECRET,
      form: 'contact',
      ip,
      cookie: undefined,
      now: NOW,
    });
    recordAttempt({ form: 'contact', ip, limit: first, now: NOW });
    const second = checkAttemptLimit({
      secret: SECRET,
      form: 'contact',
      ip,
      cookie: undefined,
      now: NOW + 5000,
    });

    expect(recordAttempt({ form: 'contact', ip, limit: second, now: NOW + 5000 })).toEqual({
      count: 2,
      startedAt: NOW,
    });
  });

  it('rounds the wait up to whole minutes', () => {
    expect(retryAfterMinutes(61_000)).toBe(2);
    expect(retryAfterMinutes(0)).toBe(1);
  });
});
