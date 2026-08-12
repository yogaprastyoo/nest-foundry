import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  MAIL_QUEUE,
  PASSWORD_RESET_EMAIL_JOB,
  VERIFICATION_EMAIL_JOB,
} from '../queue/queue.constants';
import type {
  PasswordResetEmailJob,
  VerificationEmailJob,
} from '../queue/queue.constants';

@Injectable()
export class MailQueue {
  constructor(@InjectQueue(MAIL_QUEUE) private readonly queue: Queue) {}

  async enqueueVerificationEmail(job: VerificationEmailJob): Promise<void> {
    await this.enqueue(VERIFICATION_EMAIL_JOB, job);
  }

  async enqueuePasswordResetEmail(job: PasswordResetEmailJob): Promise<void> {
    await this.enqueue(PASSWORD_RESET_EMAIL_JOB, job);
  }

  private async enqueue(
    name: string,
    data: VerificationEmailJob | PasswordResetEmailJob,
  ): Promise<void> {
    const jobId = `${name}:${data.to}:${data.token}`;

    await this.queue.add(name, data, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }
}
