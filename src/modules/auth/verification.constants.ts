export const RESEND_COOLDOWN_SECONDS = 60;
export const resendCooldownKey = (email: string): string =>
  `verify:cooldown:${email}`;
