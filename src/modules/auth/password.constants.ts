export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Shortest gap between two reset emails for one address. */
export const PASSWORD_RESET_COOLDOWN_SECONDS = 60;

export const GOOGLE_REAUTH_PURPOSES = [
  'set_password',
  'unlink_google',
] as const;

export type GoogleReauthPurpose = (typeof GOOGLE_REAUTH_PURPOSES)[number];

export const passwordResetCooldownKey = (email: string): string =>
  `password-reset:cooldown:${email}`;
