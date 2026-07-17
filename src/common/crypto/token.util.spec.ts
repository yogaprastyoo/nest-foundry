import { generateToken, sha256 } from './token.util';

describe('token.util', () => {
  it('generateToken returns a URL-safe 256-bit token', () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
    expect(t.length).toBe(43); // 32 bytes base64url
    expect(generateToken()).not.toEqual(t); // random
  });

  it('sha256 is deterministic 64-char hex', () => {
    expect(sha256('abc')).toHaveLength(64);
    expect(sha256('abc')).toBe(sha256('abc'));
    expect(sha256('abc')).not.toBe(sha256('abd'));
  });
});
