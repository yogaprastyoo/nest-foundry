/** Shortest gap between two verification emails for one address. */
export const RESEND_COOLDOWN_SECONDS = 60;

/** Longer-window cap, so rotating IPs cannot bomb one inbox at 1 email/minute. */
export const RESEND_QUOTA_MAX = 5;
export const RESEND_QUOTA_WINDOW_SECONDS = 3600;

export const resendCooldownKey = (email: string): string =>
  `verify:cooldown:${email}`;
export const resendQuotaKey = (email: string): string =>
  `verify:quota:${email}`;
