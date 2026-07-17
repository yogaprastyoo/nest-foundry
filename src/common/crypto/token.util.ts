import { createHash, randomBytes } from 'node:crypto';

/** 256-bit CSPRNG token, base64url-encoded (URL-safe, no padding). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest — used to store/look up tokens without keeping the raw value. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
