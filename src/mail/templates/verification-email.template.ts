/**
 * Table-based layout so the email renders consistently across mail clients
 * (Outlook/Gmail strip most modern CSS). Swap `primary` to rebrand.
 */
const COLOR = {
  primary: '#000000',
  textStrong: '#0f172a',
  textBody: '#64748b',
  textMuted: '#94a3b8',
  border: '#e2e8f0',
  background: '#ffffff',
};

const FONT = 'Arial,Helvetica,sans-serif';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface VerificationEmailInput {
  name: string;
  email: string;
  url: string;
  expiresInHours: number;
  appName?: string;
}

export function buildVerificationEmail(input: VerificationEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const brandName = escapeHtml(input.appName || 'Nest Foundry');
  const name = escapeHtml(input.name);
  const email = escapeHtml(input.email);
  const url = escapeHtml(input.url);
  const hours = input.expiresInHours;
  const subject = 'Verify your email address';

  const text = [
    `Hi ${input.name},`,
    '',
    `Thanks for signing up for ${input.appName || 'Nest Foundry'}. Open the link below to verify your email address and activate your account:`,
    input.url,
    '',
    `This link is valid for ${hours} hours.`,
    "If you didn't create an account, you can ignore this email.",
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLOR.background};">

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLOR.background};">
  <tr>
    <td align="center" style="padding:48px 24px;">
      <table width="520" cellpadding="0" cellspacing="0" border="0">

        <!-- Brand -->
        <tr>
          <td style="padding-bottom:40px;">
            <span style="font-family:${FONT};font-size:16px;font-weight:700;color:${COLOR.primary};">${brandName}</span>
          </td>
        </tr>

        <!-- Heading -->
        <tr>
          <td style="padding-bottom:12px;">
            <p style="margin:0;font-family:${FONT};font-size:24px;font-weight:700;color:${COLOR.textStrong};line-height:1.3;">Verify your email</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding-bottom:32px;">
            <p style="margin:0;font-family:${FONT};font-size:15px;color:${COLOR.textBody};line-height:1.65;">
              Hi <strong style="color:${COLOR.textStrong};font-weight:700;">${name}</strong>,
            </p>
            <p style="margin:12px 0 0;font-family:${FONT};font-size:15px;color:${COLOR.textBody};line-height:1.65;">
              Thanks for signing up for <strong style="color:${COLOR.textStrong};font-weight:700;">${brandName}</strong>. Click the button below to verify your email address and activate your account.
            </p>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="padding-bottom:40px;">
            <a href="${url}"
               style="display:inline-block;background-color:${COLOR.primary};color:#ffffff;font-family:${FONT};font-size:14px;font-weight:700;text-decoration:none;padding:12px 24px;border-radius:6px;">
              Verify my email
            </a>
          </td>
        </tr>

        <!-- Divider -->
        <tr>
          <td style="padding-bottom:24px;">
            <hr style="border:none;border-top:1px solid ${COLOR.border};margin:0;" />
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td>
            <p style="margin:0 0 8px;font-family:${FONT};font-size:12px;color:${COLOR.textMuted};line-height:1.7;">
              This email was sent to <a href="mailto:${email}" style="color:${COLOR.textBody};text-decoration:underline;">${email}</a> because an account was created with this address. The link is valid for ${hours} hours. If you didn't create an account, you can ignore this email.
            </p>
            <p style="margin:0;font-family:${FONT};font-size:12px;color:${COLOR.textMuted};line-height:1.7;">
              Can't click the button? <a href="${url}" style="color:${COLOR.primary};text-decoration:underline;word-break:break-all;">${url}</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>`.trim();

  return { subject, html, text };
}
