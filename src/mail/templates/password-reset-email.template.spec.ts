import { buildPasswordResetEmail } from './password-reset-email.template';

describe('buildPasswordResetEmail', () => {
  it('includes reset URL and configured expiry in both email formats', () => {
    const out = buildPasswordResetEmail({
      name: 'Test User',
      url: 'https://app.test/reset-password?token=abc',
      expiresInHours: 1,
    });

    expect(out.subject).toBe('Reset your password');
    expect(out.html).toContain('reset-password?token=abc');
    expect(out.text).toContain('reset-password?token=abc');
    expect(out.html).toContain('valid for 1 hour');
    expect(out.text).toContain('valid for 1 hour');
  });
});
