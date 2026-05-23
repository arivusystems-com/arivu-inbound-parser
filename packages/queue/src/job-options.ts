import type { JobsOptions } from 'bullmq';
import type { Env } from '@arivu/config';

export function buildDefaultJobOptions(config: Pick<Env, 'QUEUE_MAX_ATTEMPTS' | 'QUEUE_BACKOFF_MS'>): JobsOptions {
  return {
    attempts: config.QUEUE_MAX_ATTEMPTS,
    backoff: {
      type: 'exponential',
      delay: config.QUEUE_BACKOFF_MS,
    },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  };
}
