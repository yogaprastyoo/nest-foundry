import { createMailDriver } from './mail-driver.factory';
import { LogMailDriver } from './log-mail.driver';
import { ResendMailDriver } from './resend-mail.driver';

function configWith(values: Record<string, string>) {
  return { get: jest.fn((key: string) => values[key]) } as never;
}

describe('createMailDriver', () => {
  it('returns the Resend driver when MAIL_DRIVER=resend', () => {
    const driver = createMailDriver(
      configWith({
        MAIL_DRIVER: 'resend',
        RESEND_API_KEY: 're_test_key',
        MAIL_FROM: 'Loopwork <noreply@example.com>',
      }),
    );
    expect(driver).toBeInstanceOf(ResendMailDriver);
  });

  it('returns the log driver when MAIL_DRIVER=log', () => {
    const driver = createMailDriver(configWith({ MAIL_DRIVER: 'log' }));
    expect(driver).toBeInstanceOf(LogMailDriver);
  });

  it('falls back to the log driver for any unexpected value', () => {
    const driver = createMailDriver(configWith({ MAIL_DRIVER: 'something' }));
    expect(driver).toBeInstanceOf(LogMailDriver);
  });
});
