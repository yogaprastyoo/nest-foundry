import { MailQueue } from './mail.queue';
import { PASSWORD_RESET_EMAIL_JOB } from '../queue/queue.constants';

describe('MailQueue', () => {
  it('enqueues password reset email with mail retry options', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const queue = new MailQueue({ add } as never);
    const job = {
      to: 'user@example.test',
      name: 'Test User',
      url: 'https://app.test/reset-password?token=abc',
    };

    await queue.enqueuePasswordResetEmail(job);

    expect(add).toHaveBeenCalledWith(PASSWORD_RESET_EMAIL_JOB, job, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
  });
});
