import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.validation';
import { MAIL_DRIVER } from './mail.constants';
import type { MailDriver } from './drivers/mail-driver.interface';
import { buildPasswordResetEmail } from './templates/password-reset-email.template';
import { buildVerificationEmail } from './templates/verification-email.template';

const SECONDS_PER_HOUR = 3600;

@Injectable()
export class MailService {
  constructor(
    @Inject(MAIL_DRIVER) private readonly driver: MailDriver,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async sendVerificationEmail(input: {
    to: string;
    name: string;
    url: string;
  }): Promise<void> {
    // Read the TTL from config so the copy can never drift from the real expiry.
    const ttlSeconds = this.config.get('EMAIL_VERIFICATION_TTL', {
      infer: true,
    });
    const { subject, html, text } = buildVerificationEmail({
      name: input.name,
      email: input.to,
      url: input.url,
      expiresInHours: Math.round(ttlSeconds / SECONDS_PER_HOUR),
    });
    await this.driver.send({ to: input.to, subject, html, text });
  }

  async sendPasswordResetEmail(input: {
    to: string;
    name: string;
    url: string;
  }): Promise<void> {
    const ttlSeconds = this.config.get('PASSWORD_RESET_TTL', {
      infer: true,
    });
    const { subject, html, text } = buildPasswordResetEmail({
      name: input.name,
      url: input.url,
      expiresInHours: Math.round(ttlSeconds / SECONDS_PER_HOUR),
    });
    await this.driver.send({ to: input.to, subject, html, text });
  }
}
