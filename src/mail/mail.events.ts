import {
  OnQueueEvent,
  QueueEventsHost,
  QueueEventsListener,
} from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { MAIL_QUEUE } from '../queue/queue.constants';

/**
 * Note for production deployment:
 * Dead-letter visibility in this starter is emitted to application logs (pino).
 * Production systems should route `logger.error` outputs or listen directly to
 * BullMQ dead-letter events to integrate with an external alerting system (e.g. Sentry/PagerDuty).
 */
@Injectable()
@QueueEventsListener(MAIL_QUEUE)
export class MailEventsListener extends QueueEventsHost {
  private readonly logger = new Logger(MailEventsListener.name);

  @OnQueueEvent('failed')
  onFailed(event: { jobId: string; failedReason: string }): void {
    // jobId format: `${jobName}:${data.to}:${data.token}`
    const [jobName, to] = event.jobId.split(':');

    this.logger.error({
      event: 'mail_job_dead_letter',
      queue: MAIL_QUEUE,
      jobId: event.jobId,
      jobName: jobName || 'unknown',
      to: to || 'unknown',
      reason: event.failedReason,
      message: `Job ${event.jobId} in queue ${MAIL_QUEUE} failed permanently. Reason: ${event.failedReason}`,
    });
  }
}
