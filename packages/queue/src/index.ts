import { Queue, Worker, type ConnectionOptions, type Job, type JobsOptions } from 'bullmq';
import { Redis, type Redis as RedisClient } from 'ioredis';
import type { Env } from '@arivu/config';
import {
  QUEUE_NAMES,
  type MimeParseJob,
  type QueueName,
  type SmtpIngestJob,
  type AttachmentProcessJob,
  type EventDispatchJob,
  type DeadLetterJob,
} from '@arivu/types';
import { buildDefaultJobOptions } from './job-options.js';
import { moveJobToDeadLetter } from './dlq.js';

export { buildDefaultJobOptions } from './job-options.js';
export { listDeadLetterJobs, requeueDeadLetterJob, removeDeadLetterJob, moveJobToDeadLetter } from './dlq.js';

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

export function createDeadLetterQueue(connection: ConnectionOptions): Queue<DeadLetterJob> {
  return createQueue<DeadLetterJob>(QUEUE_NAMES.DEAD_LETTER, connection);
}

export function createWorker<T>(
  name: QueueName,
  processor: (job: Job<T>) => Promise<void>,
  connection: ConnectionOptions,
): Worker<T> {
  return new Worker<T>(name, async (job) => processor(job), { connection });
}

/** Worker with retries and automatic move to dead-letter after final failure. */
export function createWorkerWithDlq<T>(
  name: QueueName,
  processor: (job: Job<T>) => Promise<void>,
  connection: ConnectionOptions,
  options: {
    config: Pick<Env, 'QUEUE_MAX_ATTEMPTS' | 'QUEUE_BACKOFF_MS'>;
    deadLetterQueue: Queue<DeadLetterJob>;
  },
): Worker<T> {
  const maxAttempts = options.config.QUEUE_MAX_ATTEMPTS;
  const worker = new Worker<T>(name, async (job) => processor(job), { connection });

  worker.on('failed', (job, err) => {
    if (!job || !err) return;
    if (job.attemptsMade < maxAttempts) return;
    void moveJobToDeadLetter(options.deadLetterQueue, name, job, err).catch(() => {
      /* logged by caller if needed */
    });
  });

  return worker;
}

export function jobOptions(
  config: Pick<Env, 'QUEUE_MAX_ATTEMPTS' | 'QUEUE_BACKOFF_MS'>,
  overrides?: JobsOptions,
): JobsOptions {
  return { ...buildDefaultJobOptions(config), ...overrides };
}

export async function getQueueStats(connection: ConnectionOptions) {
  const names = Object.values(QUEUE_NAMES);
  const stats: Record<
    string,
    { waiting: number; active: number; failed: number; completed: number; delayed: number }
  > = {};

  for (const name of names) {
    const queue = new Queue(name, { connection });
    const counts = await queue.getJobCounts(
      'waiting',
      'active',
      'failed',
      'completed',
      'delayed',
    );
    stats[name] = {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      failed: counts.failed ?? 0,
      completed: counts.completed ?? 0,
      delayed: counts.delayed ?? 0,
    };
    await queue.close();
  }

  return stats;
}

export {
  QUEUE_NAMES,
  type SmtpIngestJob,
  type MimeParseJob,
  type AttachmentProcessJob,
  type EventDispatchJob,
  type DeadLetterJob,
  type Job,
};
