import type { Redis } from 'ioredis';

/** Simple greylist: first MAIL FROM from IP is deferred; retry within TTL is accepted. */
export class Greylist {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  private key(ip: string, from: string): string {
    return `greylist:${ip}:${from.toLowerCase()}`;
  }

  /** Returns true if connection should be deferred (451). */
  async shouldDefer(ip: string, from: string): Promise<boolean> {
    const k = this.key(ip, from);
    const seen = await this.redis.get(k);
    if (!seen) {
      await this.redis.set(k, '1', 'EX', this.ttlSeconds);
      return true;
    }
    await this.redis.del(k);
    return false;
  }
}
