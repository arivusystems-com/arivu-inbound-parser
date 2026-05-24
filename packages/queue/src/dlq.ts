import { Queue, type ConnectionOptions, type Job } from 'bullmq';
import { QUEUE_NAMES, type DeadLetterJob, type QueueName } from '@arivu/types';
import { buildDefaultJobOptions } from './job-options.js';
import type { Env } from '@arivu/config';

function extractContext(payload: unknown): Pick<DeadLetterJob, 'messageId' | 'tenantId' | 'mailboxId' | 'rawMimePath'> {
  if (!payload || typeof payload !== 'object') return {};
  const p = payload as Record<string, unknown>;
  return {
    messageId: typeof p.messageId === 'string' ? p.messageId : undefined,
    tenantId: typeof p.tenantId === 'string' ? p.tenantId : undefined,
    mailboxId: typeof p.mailboxId === 'string' ? p.mailboxId : undefined,
    rawMimePath: typeof p.rawMimePath === 'string' ? p.rawMimePath : undefined,
  };
}

export async function moveJobToDeadLetter(
  deadLetterQueue: Queue<DeadLetterJob>,
  originalQueue: QueueName,
  job: Job,
  error: Error,
): Promise<void> {
  const entry: DeadLetterJob = {
    originalQueue,
    originalJobId: job.id,
    payload: job.data,
    error: error.message,
    failedAt: new Date().toISOString(),
    attemptsMade: job.attemptsMade,
    ...extractContext(job.data),
  };

  await deadLetterQueue.add('failed', entry, {
    jobId: `dlq-${originalQueue}-${job.id}-${Date.now()}`,
    removeOnComplete: false,
    removeOnFail: false,
  });
}

export async function listDeadLetterJobs(
  connection: ConnectionOptions,
  limit = 50,
): Promise<Array<{ id: string; data: DeadLetterJob; timestamp: number }>> {
  const queue = new Queue<DeadLetterJob>(QUEUE_NAMES.DEAD_LETTER, { connection });
  try {
    const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed'], 0, limit - 1);
    return jobs
      .map((job) => ({
        id: job.id ?? '',
        data: job.data,
        timestamp: job.timestamp ?? 0,
      }))
      .filter((j) => j.id);
  } finally {
    await queue.close();
  }
}

export async function removeDeadLetterJob(
  connection: ConnectionOptions,
  dlqJobId: string,
): Promise<void> {
  const dlq = new Queue<DeadLetterJob>(QUEUE_NAMES.DEAD_LETTER, { connection });
  try {
    const job = await dlq.getJob(dlqJobId);
    if (!job) throw new Error(`DLQ job not found: ${dlqJobId}`);
    await job.remove();
  } finally {
    await dlq.close();
  }
}

export async function requeueDeadLetterJob(
  connection: ConnectionOptions,
  dlqJobId: string,
  config: Pick<Env, 'QUEUE_MAX_ATTEMPTS' | 'QUEUE_BACKOFF_MS'>,
): Promise<{ originalQueue: QueueName; messageId?: string }> {
  const dlq = new Queue<DeadLetterJob>(QUEUE_NAMES.DEAD_LETTER, { connection });
  const targetOpts = buildDefaultJobOptions(config);

  try {
    const job = await dlq.getJob(dlqJobId);
    if (!job) throw new Error(`DLQ job not found: ${dlqJobId}`);

    const { originalQueue, payload } = job.data;
    const target = new Queue(originalQueue, { connection });
    await target.add('requeue', payload, {
      ...targetOpts,
      jobId: `requeue-${dlqJobId}-${Date.now()}`,
    });
    await job.remove();

    const ctx = extractContext(payload);
    return { originalQueue, messageId: ctx.messageId };
  } finally {
    await dlq.close();
  }
}
