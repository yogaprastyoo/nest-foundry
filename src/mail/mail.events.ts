import {
  OnQueueEvent,
  QueueEventsHost,
  QueueEventsListener,
} from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { MAIL_QUEUE } from '../queue/queue.constants';

@Injectable()
@QueueEventsListener(MAIL_QUEUE)
export class MailEventsListener extends QueueEventsHost {
  private readonly logger = new Logger(MailEventsListener.name);

  @OnQueueEvent('failed')
  onFailed(event: { jobId: string; failedReason: string }): void {
    this.logger.error(
      `Job ${event.jobId} in queue ${MAIL_QUEUE} failed permanently. Reason: ${event.failedReason}`,
    );
  }
}
