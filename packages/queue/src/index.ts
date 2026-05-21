import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { Redis, type Redis as RedisClient } from 'ioredis';
import { QUEUE_NAMES, type MimeParseJob, type QueueName, type SmtpIngestJob } from '@arivu/types';

export function createRedisConnection(redisUrl: string, onError?: (err: Error) => void): RedisClient {
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 200, 3000),
  });
  redis.on('error', (err) => {
    onError?.(err);
  });
  return redis;
}

/** Verify Redis is reachable before starting workers. */
export async function assertRedisReady(redisUrl: string): Promise<void> {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, connectTimeout: 5000 });
  try {
    await redis.ping();
  } finally {
    await redis.quit();
  }
}

export function toBullConnection(redis: RedisClient): ConnectionOptions {
  return redis as unknown as ConnectionOptions;
}

export function createQueue<T>(name: QueueName, connection: ConnectionOptions): Queue<T> {
  return new Queue<T>(name, { connection });
}

export function createWorker<T>(
  name: QueueName,
  processor: (job: Job<T>) => Promise<void>,
  connection: ConnectionOptions,
): Worker<T> {
  return new Worker<T>(name, async (job) => processor(job), { connection });
}

export async function getQueueStats(connection: ConnectionOptions) {
  const names = Object.values(QUEUE_NAMES);
  const stats: Record<string, { waiting: number; active: number; failed: number; completed: number }> = {};

  for (const name of names) {
    const queue = new Queue(name, { connection });
    const counts = await queue.getJobCounts('waiting', 'active', 'failed', 'completed');
    stats[name] = {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      failed: counts.failed ?? 0,
      completed: counts.completed ?? 0,
    };
    await queue.close();
  }

  return stats;
}

export { QUEUE_NAMES, type SmtpIngestJob, type MimeParseJob, type Job };
