import { MailService } from './mail.service';
import { MailDriver, MailMessage } from './drivers/mail-driver.interface';

describe('MailService', () => {
  it('sends a verification email via the active driver', async () => {
    const sent: MailMessage[] = [];
    const driver: MailDriver = {
      send: (m) => {
        sent.push(m);
        return Promise.resolve();
      },
    };
    const service = new MailService(driver);
    await service.sendVerificationEmail({
      to: 'a@b.c',
      name: 'Budi',
      url: 'https://app.test/verify-email?token=abc',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('a@b.c');
    expect(sent[0].html).toContain('token=abc');
  });
});
