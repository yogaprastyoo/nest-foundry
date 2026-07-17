import { Inject, Injectable } from '@nestjs/common';
import { MAIL_DRIVER } from './mail.constants';
import type { MailDriver } from './drivers/mail-driver.interface';
import { buildVerificationEmail } from './templates/verification-email.template';

@Injectable()
export class MailService {
  constructor(@Inject(MAIL_DRIVER) private readonly driver: MailDriver) {}

  async sendVerificationEmail(input: {
    to: string;
    name: string;
    url: string;
  }): Promise<void> {
    const { subject, html, text } = buildVerificationEmail({
      name: input.name,
      url: input.url,
    });
    await this.driver.send({ to: input.to, subject, html, text });
  }
}
