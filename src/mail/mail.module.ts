import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.validation';
import { MAIL_DRIVER } from './mail.constants';
import { MailDriver } from './drivers/mail-driver.interface';
import { LogMailDriver } from './drivers/log-mail.driver';
import { ResendMailDriver } from './drivers/resend-mail.driver';
import { MailService } from './mail.service';

@Module({
  providers: [
    {
      provide: MAIL_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): MailDriver =>
        config.get('MAIL_DRIVER', { infer: true }) === 'resend'
          ? new ResendMailDriver(config)
          : new LogMailDriver(),
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
