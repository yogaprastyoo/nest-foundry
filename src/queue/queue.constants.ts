export const MAIL_QUEUE = 'mail';
export const VERIFICATION_EMAIL_JOB = 'verification-email';
export const PASSWORD_RESET_EMAIL_JOB = 'password-reset-email';

export interface VerificationEmailJob {
  to: string;
  name: string;
  url: string;
  token: string;
}

export interface PasswordResetEmailJob {
  to: string;
  name: string;
  url: string;
  token: string;
}
