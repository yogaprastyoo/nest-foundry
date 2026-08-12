import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  MAIL_QUEUE,
  PASSWORD_RESET_EMAIL_JOB,
  VERIFICATION_EMAIL_JOB,
} from '../queue/queue.constants';
import type {
  PasswordResetEmailJob,
  VerificationEmailJob,
} from '../queue/queue.constants';
import { MailService } from './mail.service';

@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  constructor(private readonly mail: MailService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === VERIFICATION_EMAIL_JOB) {
      const data = job.data as VerificationEmailJob;
      await this.mail.sendVerificationEmail(data);
      return;
    }

    if (job.name === PASSWORD_RESET_EMAIL_JOB) {
      const data = job.data as PasswordResetEmailJob;
      await this.mail.sendPasswordResetEmail(data);
    }
  }
}
