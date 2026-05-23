import type { Redis } from 'ioredis';

export interface RateLimitConfig {
  ipPerMinute: number;
  tenantPerMinute: number;
  windowSeconds?: number;
}

export class RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly config: RateLimitConfig,
  ) {}

  private async increment(key: string, limit: number, windowSec: number): Promise<boolean> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, windowSec);
    }
    return count > limit;
  }

  async checkIp(ip: string): Promise<{ limited: boolean; key: string }> {
    const windowSec = this.config.windowSeconds ?? 60;
    const key = `rl:ip:${ip}:${Math.floor(Date.now() / 1000 / windowSec)}`;
    const limited = await this.increment(key, this.config.ipPerMinute, windowSec);
    return { limited, key };
  }

  async checkTenant(tenantId: string): Promise<{ limited: boolean; key: string }> {
    const windowSec = this.config.windowSeconds ?? 60;
    const key = `rl:tenant:${tenantId}:${Math.floor(Date.now() / 1000 / windowSec)}`;
    const limited = await this.increment(key, this.config.tenantPerMinute, windowSec);
    return { limited, key };
  }
}
