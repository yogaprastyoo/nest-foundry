import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { Env } from '../config/env.validation';
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
import { PrismaService } from '../prisma/prisma.service';
import { sha256 } from '../common/crypto/token.util';

@Injectable()
@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(
    private readonly mail: MailService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }

  @OnWorkerEvent('failed')
  async onJobFailed(job: Job, error: Error): Promise<void> {
    const attemptsMade = job.attemptsMade;
    const maxAttempts = job.opts?.attempts ?? 1;

    if (attemptsMade >= maxAttempts) {
      this.logger.error(
        `Job ${job.id} (${job.name}) permanently failed after ${attemptsMade} attempts: ${error.message}`,
      );

      const webhookUrl = this.config.get('ALERT_WEBHOOK_URL', { infer: true });
      if (webhookUrl) {
        try {
          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event: 'job_failed',
              queue: MAIL_QUEUE,
              jobId: job.id,
              jobName: job.name,
              error: error.message,
              timestamp: new Date().toISOString(),
            }),
          });
        } catch (alertError) {
          this.logger.error(
            `Failed to send alert webhook for job ${job.id}: ${(alertError as Error).message}`,
          );
        }
      }
    }
  }

  async process(job: Job): Promise<void> {
    if (job.name === VERIFICATION_EMAIL_JOB) {
      const data = job.data as VerificationEmailJob;
      await this.processVerificationEmail(data);
      return;
    }

    if (job.name === PASSWORD_RESET_EMAIL_JOB) {
      const data = job.data as PasswordResetEmailJob;
      await this.processPasswordResetEmail(data);
    }
  }

  private async processVerificationEmail(
    data: VerificationEmailJob,
  ): Promise<void> {
    const tokenHash = sha256(data.token);

    // 1. Atomic claim: update sentAt if not already sent
    const { count } = await this.prisma.verificationToken.updateMany({
      where: {
        tokenHash,
        sentAt: null,
      },
      data: { sentAt: new Date() },
    });

    // Already claimed or token deleted -> skip without error
    if (count === 0) {
      this.logger.log(
        `Skipping verification email sending for token as it was already sent or expired.`,
      );
      return;
    }

    // 2. Call provider
    try {
      await this.mail.sendVerificationEmail(data);
    } catch (error) {
      // 3. Rollback claim on failure so BullMQ can retry
      await this.prisma.verificationToken.updateMany({
        where: { tokenHash },
        data: { sentAt: null },
      });
      throw error;
    }
  }

  private async processPasswordResetEmail(
    data: PasswordResetEmailJob,
  ): Promise<void> {
    const tokenHash = sha256(data.token);

    // 1. Atomic claim: update sentAt if not already sent
    const { count } = await this.prisma.verificationToken.updateMany({
      where: {
        tokenHash,
        sentAt: null,
      },
      data: { sentAt: new Date() },
    });

    // Already claimed or token deleted -> skip without error
    if (count === 0) {
      this.logger.log(
        `Skipping password reset email sending for token as it was already sent or expired.`,
      );
      return;
    }

    // 2. Call provider
    try {
      await this.mail.sendPasswordResetEmail(data);
    } catch (error) {
      // 3. Rollback claim on failure so BullMQ can retry
      await this.prisma.verificationToken.updateMany({
        where: { tokenHash },
        data: { sentAt: null },
      });
      throw error;
    }
  }
}
