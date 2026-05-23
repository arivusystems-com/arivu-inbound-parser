import cors from 'cors';
import express from 'express';
import { loadConfig } from '@arivu/config';
import { connectDatabase } from '@arivu/database';
import { createLogger, queryLogs } from '@arivu/logger';
import {
  createQueue,
  createRedisConnection,
  getQueueStats,
  jobOptions,
  listDeadLetterJobs,
  requeueDeadLetterJob,
  toBullConnection,
  QUEUE_NAMES,
} from '@arivu/queue';
import type { EventDispatchJob, MimeParseJob } from '@arivu/types';
import { createIntegrationRouter } from './integration/routes.js';
import { ValidationError } from './integration/validate.js';

const config = loadConfig();
const log = createLogger('api');
const redis = createRedisConnection(config.REDIS_URL, (err) => {
  log.warn({ err: err.message }, 'Redis connection error — is Docker running? (pnpm infra:up)');
});
const mimeParseQueue = createQueue<MimeParseJob>(QUEUE_NAMES.MIME_PARSE, toBullConnection(redis));
const eventDispatchQueue = createQueue<EventDispatchJob>(
  QUEUE_NAMES.EVENT_DISPATCH,
  toBullConnection(redis),
);

let database: Awaited<ReturnType<typeof connectDatabase>> | null = null;

async function getDb() {
  if (!database) database = await connectDatabase(config.MONGODB_URI);
  return database;
}

const app = express();
app.use(cors());
app.use(express.json());

app.use('/integrations/v1', createIntegrationRouter(config, getDb, log));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api' });
});

app.get('/admin/stats', async (_req, res, next) => {
  try {
    const db = await getDb();
    const connection = toBullConnection(redis);
    const [messageCount, failedCount, duplicateCount, processedCount, queueStats, dlqJobs] =
      await Promise.all([
        db.messages.countDocuments(),
        db.messages.countDocuments({ processingStatus: 'failed' }),
        db.messages.countDocuments({ processingStatus: 'duplicate' }),
        db.messages.countDocuments({ processingStatus: 'processed' }),
        getQueueStats(connection),
        listDeadLetterJobs(connection, 1),
      ]);
    const last = await db.messages.find().sort({ receivedAt: -1 }).limit(1).toArray();
    const dlqDepth =
      (queueStats[QUEUE_NAMES.DEAD_LETTER]?.waiting ?? 0) +
      (queueStats[QUEUE_NAMES.DEAD_LETTER]?.failed ?? 0);
    res.json({
      messagesTotal: messageCount,
      messagesFailed: failedCount,
      messagesDuplicate: duplicateCount,
      messagesProcessed: processedCount,
      dlqCount: Math.max(dlqDepth, dlqJobs.length),
      queues: queueStats,
      lastMessage: last[0] ?? null,
    });
  } catch (err) {
    next(err);
  }
});

app.get('/admin/metrics', async (_req, res, next) => {
  try {
    const db = await getDb();
    const connection = toBullConnection(redis);
    const [byStatus, queueStats, dlqJobs, eventsDispatched] = await Promise.all([
      db.messages
        .aggregate<{ _id: string; count: number }>([
          { $group: { _id: '$processingStatus', count: { $sum: 1 } } },
        ])
        .toArray(),
      getQueueStats(connection),
      listDeadLetterJobs(connection, 100),
      db.messages.countDocuments({ eventDispatchedAt: { $exists: true } }),
    ]);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const receivedLast24h = await db.messages.countDocuments({ receivedAt: { $gte: since } });

    res.json({
      messagesByStatus: Object.fromEntries(byStatus.map((r) => [r._id, r.count])),
      receivedLast24h,
      eventsDispatched,
      dlqJobs: dlqJobs.length,
      queues: queueStats,
      queueRetryPolicy: {
        maxAttempts: config.QUEUE_MAX_ATTEMPTS,
        backoffMs: config.QUEUE_BACKOFF_MS,
      },
    });
  } catch (err) {
    next(err);
  }
});

app.get('/admin/messages', async (req, res, next) => {
  try {
    const db = await getDb();
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const filter: Record<string, unknown> = {};
    if (req.query.tenantId) filter.tenantId = req.query.tenantId;
    if (req.query.mailboxId) filter.mailboxId = req.query.mailboxId;
    if (req.query.status) filter.processingStatus = req.query.status;
    const messages = await db.messages.find(filter).sort({ receivedAt: -1 }).limit(limit).toArray();
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

app.get('/admin/messages/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    const message = await db.messages.findOne({ _id: req.params.id });
    if (!message) return res.status(404).json({ error: 'Message not found' });
    res.json({ message });
  } catch (err) {
    next(err);
  }
});

async function enqueueParseReplay(messageId: string) {
  const db = await getDb();
  const message = await db.messages.findOne({ _id: messageId });
  if (!message) {
    const err = new Error('Message not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  if (!message.rawMimePath) {
    const err = new Error('Message has no raw MIME path — cannot replay') as Error & {
      statusCode?: number;
    };
    err.statusCode = 400;
    throw err;
  }

  const job: MimeParseJob = {
    messageId: message._id,
    tenantId: message.tenantId,
    mailboxId: message.mailboxId,
    rawMimePath: message.rawMimePath,
  };

  await mimeParseQueue.add('parse', job, {
    ...jobOptions(config),
    jobId: `${message._id}-replay-${Date.now()}`,
  });

  await db.messages.updateOne(
    { _id: message._id },
    {
      $set: { processingStatus: 'queued' },
      $unset: { errorMessage: '', eventDispatchedAt: '' },
    },
  );

  log.info({ messageId: message._id }, 'Parse replay enqueued');
  return { ok: true as const, messageId: message._id, status: 'queued' as const };
}

app.post('/admin/messages/:id/replay', async (req, res, next) => {
  try {
    res.json(await enqueueParseReplay(req.params.id));
  } catch (err) {
    next(err);
  }
});

app.post('/admin/messages/:id/redispatch-event', async (req, res, next) => {
  try {
    const db = await getDb();
    const message = await db.messages.findOne({ _id: req.params.id });
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (message.processingStatus !== 'processed') {
      return res.status(400).json({
        error: 'Message must be processed before redispatching event',
        status: message.processingStatus,
      });
    }

    await db.messages.updateOne({ _id: message._id }, { $unset: { eventDispatchedAt: '' } });

    await eventDispatchQueue.add(
      'dispatch',
      {
        messageId: message._id,
        tenantId: message.tenantId,
        mailboxId: message.mailboxId,
      },
      {
        ...jobOptions(config),
        jobId: `email-received-${message._id}-redispatch-${Date.now()}`,
      },
    );

    log.info({ messageId: message._id }, 'Event redispatch enqueued');
    res.json({ ok: true, messageId: message._id });
  } catch (err) {
    next(err);
  }
});

app.get('/admin/mailboxes', async (_req, res, next) => {
  try {
    const db = await getDb();
    const [tenants, mailboxes] = await Promise.all([
      db.tenants.find().toArray(),
      db.mailboxes.find().toArray(),
    ]);
    res.json({ tenants, mailboxes });
  } catch (err) {
    next(err);
  }
});

app.get('/admin/queues', async (_req, res, next) => {
  try {
    const queues = await getQueueStats(toBullConnection(redis));
    res.json({ queues });
  } catch (err) {
    next(err);
  }
});

app.get('/admin/failures', async (_req, res, next) => {
  try {
    const db = await getDb();
    const failures = await db.messages
      .find({ processingStatus: { $in: ['failed', 'duplicate'] } })
      .sort({ receivedAt: -1 })
      .limit(100)
      .toArray();
    res.json({ failures });
  } catch (err) {
    next(err);
  }
});

app.post('/admin/failures/:id/retry', async (req, res, next) => {
  try {
    res.json(await enqueueParseReplay(req.params.id));
  } catch (err) {
    next(err);
  }
});

app.get('/admin/dlq', async (_req, res, next) => {
  try {
    const jobs = await listDeadLetterJobs(toBullConnection(redis), 100);
    res.json({ jobs });
  } catch (err) {
    next(err);
  }
});

app.post('/admin/dlq/:jobId/requeue', async (req, res, next) => {
  try {
    const result = await requeueDeadLetterJob(
      toBullConnection(redis),
      req.params.jobId,
      config,
    );
    if (result.messageId) {
      const db = await getDb();
      await db.messages.updateOne(
        { _id: result.messageId },
        { $set: { processingStatus: 'queued' }, $unset: { errorMessage: '' } },
      );
    }
    log.info({ dlqJobId: req.params.jobId, ...result }, 'DLQ job requeued');
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

app.get('/admin/logs', async (req, res, next) => {
  try {
    const result = await queryLogs({
      limit: Number(req.query.limit) || 200,
      level: typeof req.query.level === 'string' ? req.query.level : undefined,
      messageId: typeof req.query.messageId === 'string' ? req.query.messageId : undefined,
      tenantId: typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined,
      service: typeof req.query.service === 'string' ? req.query.service : undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.use(
  (
    err: Error & { statusCode?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    log.error({ err }, 'API error');
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    res.status(status).json({ error: err.message });
  },
);

async function main() {
  await getDb();
  const server = app.listen(config.API_PORT, config.API_HOST, () => {
    log.info({ host: config.API_HOST, port: config.API_PORT }, 'API listening');
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log.fatal(
        { port: config.API_PORT },
        'Port already in use — stop the old process: pnpm dev:stop',
      );
      process.exit(1);
    }
    throw err;
  });
}

main().catch((err) => {
  log.fatal({ err }, 'API failed to start');
  process.exit(1);
});
