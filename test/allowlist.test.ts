import { describe, expect, it } from 'vitest';
import { chefAllowlist, isChefNumber } from '../src/worker/auth';
import type { Env } from '../src/worker/env';

const env = (list?: string, single?: string): Env =>
  ({ CHEF_PHONE_E164_LIST: list, CHEF_PHONE_E164: single }) as Env;

describe('chef allowlist', () => {
  it('parses a comma-separated list and normalizes entries', () => {
    const set = chefAllowlist(env('+919000000001, 9000000002,09000000003'));
    expect(set).toEqual(new Set(['+919000000001', '+919000000002', '+919000000003']));
  });

  it('merges the single-number fallback variable', () => {
    const set = chefAllowlist(env('+919000000001', '9000000009'));
    expect(set.has('+919000000009')).toBe(true);
  });

  it('accepts allowlisted numbers in any normalized input form', () => {
    const e = env('+919000000001');
    expect(isChefNumber(e, '+919000000001')).toBe(true);
  });

  it('rejects unlisted numbers and empty configuration', () => {
    expect(isChefNumber(env('+919000000001'), '+919111111111')).toBe(false);
    expect(isChefNumber(env(), '+919000000001')).toBe(false);
    expect(chefAllowlist(env('', '')).size).toBe(0);
  });

  it('drops malformed entries instead of matching loosely', () => {
    const set = chefAllowlist(env('12345,not-a-phone,+919000000001'));
    expect(set.size).toBe(1);
  });
});
