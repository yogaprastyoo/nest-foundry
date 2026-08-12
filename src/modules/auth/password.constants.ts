import { randomBytes } from 'node:crypto';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const GOOGLE_REAUTH_PURPOSES = [
  'set_password',
  'unlink_google',
] as const;

export type GoogleReauthPurpose = (typeof GOOGLE_REAUTH_PURPOSES)[number];

export function randomReauthCode(): string {
  return randomBytes(32).toString('base64url');
}
