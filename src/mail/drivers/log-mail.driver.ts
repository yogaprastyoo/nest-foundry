import { Injectable, Logger } from '@nestjs/common';
import { MailDriver, MailMessage } from './mail-driver.interface';

/** Dev/test driver: logs the message (incl. links) instead of sending. Never use in production. */
@Injectable()
export class LogMailDriver implements MailDriver {
  private readonly logger = new Logger('MailLog');

  send(message: MailMessage): Promise<void> {
    this.logger.log(
      `Email to ${message.to} | ${message.subject}\n${message.text}`,
    );
    return Promise.resolve();
  }
}
