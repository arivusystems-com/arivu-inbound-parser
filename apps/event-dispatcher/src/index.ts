import { loadConfig } from '@arivu/config';
import { connectDatabase, startMongoConnectionMonitor } from '@arivu/database';
import {
  buildEmailReceivedEvent,
  createEventPublisher,
  emailReceivedEventSchema,
} from '@arivu/events';
import { createLogger, childWithContext } from '@arivu/logger';
import {
  assertRedisReady,
  createDeadLetterQueue,
  createRedisConnection,
  createWorkerWithDlq,
  registerWorkerHealth,
  startRedisConnectionMonitor,
  toBullConnection,
  QUEUE_NAMES,
  type EventDispatchJob,
} from '@arivu/queue';

const config = loadConfig();
const log = createLogger('event-dispatcher');
const publisher = createEventPublisher(config);

async function main() {
  await assertRedisReady(config.REDIS_URL).catch(() => {
    throw new Error(
      'Cannot connect to Redis — start infrastructure: pnpm infra:up (or docker compose up -d)',
    );
  });

  const database = await connectDatabase(config.MONGODB_URI);
  const redis = createRedisConnection(config.REDIS_URL, (err) => {
    log.warn({ err: err.message }, 'Redis connection error');
  });

  if (config.CRM_WEBHOOK_URL) {
    log.info({ url: config.CRM_WEBHOOK_URL }, 'CRM webhook publisher enabled');
  } else {
    log.info('No CRM_WEBHOOK_URL — events logged to stdout (ConsoleEventPublisher)');
  }

  const deadLetterQueue = createDeadLetterQueue(toBullConnection(redis));

  const worker = createWorkerWithDlq<EventDispatchJob>(
    QUEUE_NAMES.EVENT_DISPATCH,
    async (job) => {
      const { messageId, tenantId, mailboxId } = job.data;
      const ctx = childWithContext(log, { messageId, tenantId, mailboxId, jobId: job.id });

      const message = await database.messages.findOne({ _id: messageId, tenantId });
      if (!message) {
        throw new Error(`Message not found: ${messageId}`);
      }

      if (message.processingStatus !== 'processed') {
        throw new Error(
          `Message not ready for dispatch (status=${message.processingStatus}) — will retry`,
        );
      }

      if (message.eventDispatchedAt) {
        ctx.info({ eventDispatchedAt: message.eventDispatchedAt }, 'Event already dispatched — skipping');
        return;
      }

      const event = buildEmailReceivedEvent(message);
      emailReceivedEventSchema.parse(event);

      await publisher.publish(event);

      const dispatchedAt = new Date().toISOString();
      const updated = await database.messages.updateOne(
        { _id: messageId, tenantId, eventDispatchedAt: { $exists: false } },
        { $set: { eventDispatchedAt: dispatchedAt } },
      );

      if (updated.matchedCount === 0) {
        ctx.warn('Event published but another worker marked dispatch — idempotent OK');
      } else {
        ctx.info({ event: event.event, threadId: event.threadId }, 'email.received dispatched');
      }
    },
    toBullConnection(redis),
    { config, deadLetterQueue },
  );

  registerWorkerHealth(worker, redis, {
    onWorkerError: (err) => log.error({ err }, 'Event dispatcher worker error'),
    onRedisClosed: () => {
      log.fatal('Redis connection closed — exiting for restart');
      process.exit(1);
    },
  });
  startMongoConnectionMonitor(config.MONGODB_URI, {
    onFailure: (err, failures) =>
      log.warn({ err: err.message, failures }, 'MongoDB health check failed'),
    onGiveUp: (err) => {
      log.fatal({ err }, 'MongoDB unreachable — exiting for restart');
      process.exit(1);
    },
  });
  startRedisConnectionMonitor(redis, {
    onFailure: (err, failures) =>
      log.warn({ err: err.message, failures }, 'Redis health check failed'),
    onGiveUp: (err) => {
      log.fatal({ err }, 'Redis unreachable — exiting for restart');
      process.exit(1);
    },
  });

  log.info({ queue: QUEUE_NAMES.EVENT_DISPATCH }, 'Event dispatcher started');
}

main().catch((err) => {
  log.fatal({ err }, 'Event dispatcher failed to start');
  process.exit(1);
});
