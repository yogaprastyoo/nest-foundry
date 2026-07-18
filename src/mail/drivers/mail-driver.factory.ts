import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.validation';
import type { MailDriver } from './mail-driver.interface';
import { LogMailDriver } from './log-mail.driver';
import { ResendMailDriver } from './resend-mail.driver';

/**
 * Picks the transport from MAIL_DRIVER. `log` is the dev-only default and is
 * rejected in production by env validation, since it prints verification
 * links (and therefore tokens) to the logs.
 */
export function createMailDriver(config: ConfigService<Env, true>): MailDriver {
  return config.get('MAIL_DRIVER', { infer: true }) === 'resend'
    ? new ResendMailDriver(config)
    : new LogMailDriver();
}
