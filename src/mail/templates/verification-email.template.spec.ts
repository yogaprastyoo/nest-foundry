import { buildVerificationEmail } from './verification-email.template';

const base = {
  name: 'Test User',
  email: 'user@example.test',
  url: 'https://app.test/verify-email?token=abc',
  expiresInHours: 24,
};

describe('buildVerificationEmail', () => {
  it('includes the URL in both the button and the plain-text fallback', () => {
    const out = buildVerificationEmail(base);
    expect(out.subject).toMatch(/verify/i);
    expect(out.html).toContain(
      'href="https://app.test/verify-email?token=abc"',
    );
    expect(out.text).toContain('https://app.test/verify-email?token=abc');
  });

  it('escapes the name so it cannot inject markup', () => {
    const out = buildVerificationEmail({
      ...base,
      name: '<script>alert(1)</script>',
    });
    expect(out.html).not.toContain('<script>alert(1)</script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('shows the recipient and the configured expiry in the footer', () => {
    const out = buildVerificationEmail({ ...base, expiresInHours: 2 });
    expect(out.html).toContain('user@example.test');
    expect(out.html).toContain('valid for 2 hours');
    expect(out.text).toContain('valid for 2 hours');
  });

  it('uses black as the primary colour for the brand and CTA', () => {
    const out = buildVerificationEmail(base);
    expect(out.html).toContain('background-color:#000000');
  });
});
