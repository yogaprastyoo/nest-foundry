import { RedisThrottlerStorage } from './redis-throttler-storage.service';

describe('RedisThrottlerStorage', () => {
  let redis: { eval: jest.Mock };
  let storage: RedisThrottlerStorage;

  beforeEach(() => {
    redis = { eval: jest.fn() };
    storage = new RedisThrottlerStorage(redis as never);
  });

  it('parses unblocked Lua response into ThrottlerStorageRecord', async () => {
    redis.eval.mockResolvedValue([1, 59500, 0, 0] as never);
    const rec = await storage.increment('req-1', 60000, 10, 0);
    expect(rec).toEqual({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'throttle:req-1',
      60000,
      10,
      0,
    );
  });

  it('parses blocked Lua response into ThrottlerStorageRecord', async () => {
    redis.eval.mockResolvedValue([11, 59000, 1, 30000] as never);
    const rec = await storage.increment('req-1', 60000, 10, 30000);
    expect(rec).toEqual({
      totalHits: 11,
      timeToExpire: 59,
      isBlocked: true,
      timeToBlockExpire: 30,
    });
  });
});
