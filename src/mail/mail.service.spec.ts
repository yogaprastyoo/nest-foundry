import { MailService } from './mail.service';
import { MailDriver, MailMessage } from './drivers/mail-driver.interface';

function build(ttlSeconds = 86400) {
  const sent: MailMessage[] = [];
  const driver: MailDriver = {
    send: (m) => {
      sent.push(m);
      return Promise.resolve();
    },
  };
  const config = { get: jest.fn(() => ttlSeconds) };
  return { service: new MailService(driver, config as never), sent };
}

describe('MailService', () => {
  it('sends a verification email via the active driver', async () => {
    const { service, sent } = build();
    await service.sendVerificationEmail({
      to: 'user@example.test',
      name: 'Test User',
      url: 'https://app.test/verify-email?token=abc',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('user@example.test');
    expect(sent[0].subject).toMatch(/verify/i);
    expect(sent[0].html).toContain('token=abc');
    expect(sent[0].text).toContain('token=abc');
  });

  it('derives the stated expiry from EMAIL_VERIFICATION_TTL', async () => {
    const { service, sent } = build(7200); // 2 hours
    await service.sendVerificationEmail({
      to: 'user@example.test',
      name: 'Test User',
      url: 'https://app.test/verify-email?token=abc',
    });
    expect(sent[0].html).toContain('valid for 2 hours');
  });
});
