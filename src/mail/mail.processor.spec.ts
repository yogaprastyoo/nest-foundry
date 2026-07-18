import { Job } from 'bullmq';
import { MailProcessor } from './mail.processor';
import { MailService } from './mail.service';
import { VERIFICATION_EMAIL_JOB } from '../queue/queue.constants';

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
});
