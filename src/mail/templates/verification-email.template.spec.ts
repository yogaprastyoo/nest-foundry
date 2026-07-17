import { buildVerificationEmail } from './verification-email.template';

describe('buildVerificationEmail', () => {
  it('includes the URL and escapes the name in HTML', () => {
    const out = buildVerificationEmail({
      name: '<script>alert(1)</script>',
      url: 'https://app.test/verify-email?token=abc',
    });
    expect(out.subject).toMatch(/verify/i);
    expect(out.html).toContain('https://app.test/verify-email?token=abc');
    expect(out.html).not.toContain('<script>alert(1)</script>');
    expect(out.html).toContain('&lt;script&gt;');
    expect(out.text).toContain('https://app.test/verify-email?token=abc');
  });
});
