function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildVerificationEmail(input: { name: string; url: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const name = escapeHtml(input.name);
  const url = input.url; // server-built from config, safe in href
  return {
    subject: 'Verify your email address',
    html: `<p>Hi ${name},</p>
<p>Please verify your email address by clicking the link below:</p>
<p><a href="${url}">Verify my email</a></p>
<p>If you did not create an account, you can ignore this email.</p>`,
    text: `Hi ${input.name},

Please verify your email address by opening this link:
${url}

If you did not create an account, you can ignore this email.`,
  };
}
