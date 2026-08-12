import { Logger } from '@nestjs/common';
import { MailEventsListener } from './mail.events';

describe('MailEventsListener', () => {
  it('logs error when job fails in queue', () => {
    const listener = new MailEventsListener();
    const loggerInstance = new Logger(MailEventsListener.name);
    const errorSpy = jest.spyOn(loggerInstance, 'error').mockImplementation();
    (listener as unknown as { logger: Logger }).logger = loggerInstance;

    listener.onFailed({
      jobId: 'verification-email:test@example.test:t1',
      failedReason: 'Connection timeout',
    });

    expect(errorSpy).toHaveBeenCalledWith(
      'Job verification-email:test@example.test:t1 in queue mail failed permanently. Reason: Connection timeout',
    );
  });
});
