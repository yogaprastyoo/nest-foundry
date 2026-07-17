import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { Env } from '../../config/env.validation';
import type { MailDriver, MailMessage } from './mail-driver.interface';

@Injectable()
export class ResendMailDriver implements MailDriver {
  private readonly client: Resend;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    this.client = new Resend(config.get('RESEND_API_KEY', { infer: true }));
    this.from = config.get('MAIL_FROM', { infer: true });
  }

  async send(message: MailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (error) {
      throw new Error(`Resend failed: ${error.message}`);
    }
  }
}
