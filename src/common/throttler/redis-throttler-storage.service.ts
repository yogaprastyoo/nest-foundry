import { Inject, Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';

type StorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Redis-backed storage for @nestjs/throttler v6 using the app's shared ioredis
 * connection.
 *
 * Uses a single Lua script per `increment()` call to guarantee atomic hit
 * counter and block timer logic across concurrent requests / multi-pod deploys.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly script = `
    local key = KEYS[1]
    local ttl = tonumber(ARGV[1])
    local limit = tonumber(ARGV[2])
    local blockDuration = tonumber(ARGV[3])

    local blockKey = key .. ":blocked"
    if redis.call("EXISTS", blockKey) == 1 then
      local blockTtl = redis.call("PTTL", blockKey)
      return { limit + 1, 0, 1, blockTtl }
    end

    local hits = redis.call("INCR", key)
    if hits == 1 then
      redis.call("PEXPIRE", key, ttl)
    end
    local pttl = redis.call("PTTL", key)

    if hits > limit and blockDuration > 0 then
      redis.call("SET", blockKey, "1", "PX", blockDuration)
      return { hits, pttl, 1, blockDuration }
    end

    return { hits, pttl, 0, 0 }
  `;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): Promise<StorageRecord> {
    const res = (await this.redis.eval(
      this.script,
      1,
      `throttle:${key}`,
      ttl,
      limit,
      blockDuration,
    )) as [number, number, number, number];

    return {
      totalHits: Number(res[0]),
      timeToExpire: Math.max(0, Math.ceil(Number(res[1]) / 1000)),
      isBlocked: Number(res[2]) === 1,
      timeToBlockExpire: Math.max(0, Math.ceil(Number(res[3]) / 1000)),
    };
  }
}
