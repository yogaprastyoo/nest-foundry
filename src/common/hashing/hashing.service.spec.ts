import { HashingService } from './hashing.service';

describe('HashingService', () => {
  const service = new HashingService();

  beforeAll(async () => {
    await service.onModuleInit();
  });

  it('hash menghasilkan argon2id dan verify cocok', async () => {
    const hash = await service.hash('rahasia123');
    expect(hash).toContain('$argon2id$');
    await expect(service.verify(hash, 'rahasia123')).resolves.toBe(true);
    await expect(service.verify(hash, 'salah')).resolves.toBe(false);
  });

  it('verifyDummy tidak melempar dan tidak pernah true', async () => {
    await expect(service.verifyDummy('apapun')).resolves.toBeUndefined();
  });
});
