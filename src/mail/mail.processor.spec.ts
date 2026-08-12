import { Job } from 'bullmq';
import { MailProcessor } from './mail.processor';
import { MailService } from './mail.service';
import {
  PASSWORD_RESET_EMAIL_JOB,
  VERIFICATION_EMAIL_JOB,
} from '../queue/queue.constants';

describe('MailProcessor', () => {
  it('routes a verification-email job to MailService.sendVerificationEmail', async () => {
    const sendVerificationEmail = jest.fn().mockResolvedValue(undefined);
    const mail = { sendVerificationEmail } as unknown as MailService;
    const processor = new MailProcessor(mail);
    const job = {
      name: VERIFICATION_EMAIL_JOB,
      data: {
        to: 'user@example.test',
        name: 'Test User',
        url: 'https://x/verify?token=t',
      },
    } as Job;

    await processor.process(job);

    expect(sendVerificationEmail).toHaveBeenCalledWith({
      to: 'user@example.test',
      name: 'Test User',
      url: 'https://x/verify?token=t',
    });
  });

  it('routes a password-reset-email job to MailService.sendPasswordResetEmail', async () => {
    const sendPasswordResetEmail = jest.fn().mockResolvedValue(undefined);
    const mail = { sendPasswordResetEmail } as unknown as MailService;
    const processor = new MailProcessor(mail);
    const job = {
      name: PASSWORD_RESET_EMAIL_JOB,
      data: {
        to: 'user@example.test',
        name: 'Test User',
        url: 'https://app.test/reset-password?token=t',
      },
    } as Job;

    await processor.process(job);

    expect(sendPasswordResetEmail).toHaveBeenCalledWith({
      to: 'user@example.test',
      name: 'Test User',
      url: 'https://app.test/reset-password?token=t',
    });
  });
});
