import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.validation';
import { MAIL_QUEUE } from '../queue/queue.constants';
import { MAIL_DRIVER } from './mail.constants';
import { MailDriver } from './drivers/mail-driver.interface';
import { LogMailDriver } from './drivers/log-mail.driver';
import { ResendMailDriver } from './drivers/resend-mail.driver';
import { MailService } from './mail.service';
import { MailQueue } from './mail.queue';
import { MailProcessor } from './mail.processor';

@Module({
  imports: [BullModule.registerQueue({ name: MAIL_QUEUE })],
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
    MailQueue,
    MailProcessor,
  ],
  exports: [MailService, MailQueue],
})
export class MailModule {}
