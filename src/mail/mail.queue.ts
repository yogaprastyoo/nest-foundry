import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { MAIL_QUEUE, VERIFICATION_EMAIL_JOB } from '../queue/queue.constants';
import type { VerificationEmailJob } from '../queue/queue.constants';

@Injectable()
export class MailQueue {
  constructor(@InjectQueue(MAIL_QUEUE) private readonly queue: Queue) {}

  async enqueueVerificationEmail(job: VerificationEmailJob): Promise<void> {
    await this.queue.add(VERIFICATION_EMAIL_JOB, job, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }
}
