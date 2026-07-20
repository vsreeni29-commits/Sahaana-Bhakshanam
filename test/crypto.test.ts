import { describe, expect, it } from 'vitest';
import { hmacSha256Hex, sha256Hex, timingSafeEqualStr, randomToken } from '../src/worker/util/crypto';

describe('crypto primitives', () => {
  it('produces a stable HMAC-SHA256 hex signature (relay X-SB-Signature)', async () => {
    const sig = await hmacSha256Hex('secret', 'payload');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(sig).toBe(await hmacSha256Hex('secret', 'payload'));
    expect(sig).not.toBe(await hmacSha256Hex('other', 'payload'));
  });

  it('hashes session tokens with SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('compares digests in constant time semantics', () => {
    expect(timingSafeEqualStr('aabb', 'aabb')).toBe(true);
    expect(timingSafeEqualStr('aabb', 'aabc')).toBe(false);
    expect(timingSafeEqualStr('aabb', 'aab')).toBe(false);
  });

  it('generates 256-bit unique session tokens', () => {
    const a = randomToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(randomToken());
  });
});
