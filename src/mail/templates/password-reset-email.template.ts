export interface PasswordResetEmailInput {
  name: string;
  url: string;
  expiresInHours: number;
}

export function buildPasswordResetEmail(input: PasswordResetEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = 'Reset your password';
  const expiry = `${input.expiresInHours} hour${input.expiresInHours === 1 ? '' : 's'}`;
  const text = [
    `Hi ${input.name},`,
    '',
    'We received a request to reset your password. Open the link below to choose a new password:',
    input.url,
    '',
    `This link is valid for ${expiry}.`,
    "If you didn't request a password reset, you can ignore this email.",
  ].join('\n');
  const html = `<p>Hi ${input.name},</p><p>We received a request to reset your password. <a href="${input.url}">Reset your password</a>.</p><p>This link is valid for ${expiry}.</p><p>If you didn't request a password reset, you can ignore this email.</p>`;

  return { subject, html, text };
}
