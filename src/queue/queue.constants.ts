export const MAIL_QUEUE = 'mail';
export const VERIFICATION_EMAIL_JOB = 'verification-email';

export interface VerificationEmailJob {
  to: string;
  name: string;
  url: string;
}
