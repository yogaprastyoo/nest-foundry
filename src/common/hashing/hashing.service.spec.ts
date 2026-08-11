import { Logger } from '@nestjs/common';
import { HashingService } from './hashing.service';

describe('HashingService', () => {
  const service = new HashingService();

  beforeAll(async () => {
    await service.onModuleInit();
  });

  it('hash produces argon2id and verify matches', async () => {
    const hash = await service.hash('secret123');
    expect(hash).toContain('$argon2id$');
    await expect(service.verify(hash, 'secret123')).resolves.toBe(true);
    await expect(service.verify(hash, 'wrong')).resolves.toBe(false);
  });

  it('swallows a dummy verification failure', async () => {
    jest
      .spyOn(service, 'verify')
      .mockRejectedValueOnce(new Error('argon2 unavailable'));
    const loggerWarn = jest.spyOn(Logger.prototype, 'warn');

    await expect(service.verifyDummy('password123')).resolves.toBeUndefined();
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('verifyDummy does not throw and is never true', async () => {
    await expect(service.verifyDummy('anything')).resolves.toBeUndefined();
  });
});
