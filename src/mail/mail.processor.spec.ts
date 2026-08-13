jest.mock('../prisma/prisma.service');

import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { Env } from '../config/env.validation';
import { MailProcessor } from './mail.processor';
import { MailService } from './mail.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  PASSWORD_RESET_EMAIL_JOB,
  VERIFICATION_EMAIL_JOB,
} from '../queue/queue.constants';

describe('MailProcessor', () => {
  let prisma: {
    verificationToken: {
      updateMany: jest.Mock;
    };
  };
  let config: { get: jest.Mock };

  beforeEach(() => {
    prisma = {
      verificationToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    config = {
      get: jest.fn().mockReturnValue(undefined),
    };
  });

  it('routes a verification-email job to MailService.sendVerificationEmail when claimed', async () => {
    const sendVerificationEmail = jest.fn().mockResolvedValue(undefined);
    const mail = { sendVerificationEmail } as unknown as MailService;
    const processor = new MailProcessor(
      mail,
      prisma as unknown as PrismaService,
      config as unknown as ConfigService<Env, true>,
    );
    const job = {
      name: VERIFICATION_EMAIL_JOB,
      data: {
        to: 'user@example.test',
        name: 'Test User',
        url: 'https://x/verify?token=t',
        token: 'token123',
      },
    } as Job;

    await processor.process(job);

    expect(prisma.verificationToken.updateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: expect.any(String) as unknown,
        sentAt: null,
      },
      data: { sentAt: expect.any(Date) as unknown },
    });
    expect(sendVerificationEmail).toHaveBeenCalledWith(job.data);
  });

  it('skips sending verification email on retry after successful claim (count === 0)', async () => {
    prisma.verificationToken.updateMany.mockResolvedValue({ count: 0 });
    const sendVerificationEmail = jest.fn();
    const mail = { sendVerificationEmail } as unknown as MailService;
    const processor = new MailProcessor(
      mail,
      prisma as unknown as PrismaService,
      config as unknown as ConfigService<Env, true>,
    );
    const job = {
      name: VERIFICATION_EMAIL_JOB,
      data: {
        to: 'user@example.test',
        name: 'Test User',
        url: 'https://x/verify?token=t',
        token: 'token123',
      },
    } as Job;

    await processor.process(job);

    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('rolls back claim (sentAt: null) and throws error when provider throws', async () => {
    prisma.verificationToken.updateMany
      .mockResolvedValueOnce({ count: 1 }) // First claim succeeds
      .mockResolvedValueOnce({ count: 1 }); // Rollback succeeds

    const sendVerificationEmail = jest
      .fn()
      .mockRejectedValue(new Error('Provider failure'));
    const mail = { sendVerificationEmail } as unknown as MailService;
    const processor = new MailProcessor(
      mail,
      prisma as unknown as PrismaService,
      config as unknown as ConfigService<Env, true>,
    );
    const job = {
      name: VERIFICATION_EMAIL_JOB,
      data: {
        to: 'user@example.test',
        name: 'Test User',
        url: 'https://x/verify?token=t',
        token: 'token123',
      },
    } as Job;

    await expect(processor.process(job)).rejects.toThrow('Provider failure');

    // Verification of rollback updateMany
    expect(prisma.verificationToken.updateMany).toHaveBeenNthCalledWith(2, {
      where: { tokenHash: expect.any(String) as unknown },
      data: { sentAt: null },
    });
  });

  it('allows second attempt to retry and succeed after provider failure rollback', async () => {
    const sendVerificationEmail = jest
      .fn()
      .mockRejectedValueOnce(new Error('Provider temporary outage'))
      .mockResolvedValueOnce(undefined);

    const mail = { sendVerificationEmail } as unknown as MailService;
    const processor = new MailProcessor(
      mail,
      prisma as unknown as PrismaService,
      config as unknown as ConfigService<Env, true>,
    );
    const job = {
      name: VERIFICATION_EMAIL_JOB,
      data: {
        to: 'user@example.test',
        name: 'Test User',
        url: 'https://x/verify?token=t',
        token: 'token123',
      },
    } as Job;

    // Attempt 1: fails and rolls back
    prisma.verificationToken.updateMany.mockResolvedValue({ count: 1 });
    await expect(processor.process(job)).rejects.toThrow(
      'Provider temporary outage',
    );

    // Attempt 2: retry succeeds
    prisma.verificationToken.updateMany.mockResolvedValue({ count: 1 });
    await processor.process(job);

    expect(sendVerificationEmail).toHaveBeenCalledTimes(2);
  });

  it('routes a password-reset-email job to MailService.sendPasswordResetEmail', async () => {
    const sendPasswordResetEmail = jest.fn().mockResolvedValue(undefined);
    const mail = { sendPasswordResetEmail } as unknown as MailService;
    const processor = new MailProcessor(
      mail,
      prisma as unknown as PrismaService,
      config as unknown as ConfigService<Env, true>,
    );
    const job = {
      name: PASSWORD_RESET_EMAIL_JOB,
      data: {
        to: 'user@example.test',
        name: 'Test User',
        url: 'https://app.test/reset-password?token=t',
        token: 'resetToken123',
      },
    } as Job;

    await processor.process(job);

    expect(sendPasswordResetEmail).toHaveBeenCalledWith(job.data);
  });
});
