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

  it('verifyDummy does not throw and is never true', async () => {
    await expect(service.verifyDummy('anything')).resolves.toBeUndefined();
  });
});
