import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { MAIL_QUEUE } from '../queue/queue.constants';
import { MAIL_DRIVER } from './mail.constants';
import { createMailDriver } from './drivers/mail-driver.factory';
import { MailService } from './mail.service';
import { MailQueue } from './mail.queue';
import { MailProcessor } from './mail.processor';

@Module({
  imports: [BullModule.registerQueue({ name: MAIL_QUEUE })],
  providers: [
    {
      provide: MAIL_DRIVER,
      inject: [ConfigService],
      useFactory: createMailDriver,
    },
    MailService,
    MailQueue,
    MailProcessor,
  ],
  exports: [MailService, MailQueue],
})
export class MailModule {}
