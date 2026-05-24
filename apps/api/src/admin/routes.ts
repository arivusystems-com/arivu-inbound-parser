import { Router } from 'express';
import { isAdminAuthEnabled, type Env } from '@arivu/config';
import type { DatabaseClient } from '@arivu/database';
import type { Logger } from '@arivu/logger';
import { queryLogs } from '@arivu/logger';
import {
  createQueue,
  createRedisConnection,
  getQueueStats,
  jobOptions,
  listDeadLetterJobs,
  requeueDeadLetterJob,
  removeDeadLetterJob,
  toBullConnection,
  QUEUE_NAMES,
} from '@arivu/queue';
import { createObjectStorage } from '@arivu/storage';
import type { EventDispatchJob, MimeParseJob } from '@arivu/types';
import { handleAdminLogin, requireAdminAuth } from './auth.js';

type RedisClient = ReturnType<typeof createRedisConnection>;

export interface AdminRouterDeps {
  config: Env;
  getDb: () => Promise<DatabaseClient>;
  log: Logger;
  redis: RedisClient;
}

export function createAdminRouter(deps: AdminRouterDeps): Router {
  const { config, getDb, log, redis } = deps;
  const router = Router();
  const connection = () => toBullConnection(redis);
  const storage = createObjectStorage(config);
  const mimeParseQueue = createQueue<MimeParseJob>(QUEUE_NAMES.MIME_PARSE, connection());
  const eventDispatchQueue = createQueue<EventDispatchJob>(
    QUEUE_NAMES.EVENT_DISPATCH,
    connection(),
  );

  router.get('/auth/status', (_req, res) => {
    res.json({ authEnabled: isAdminAuthEnabled(config) });
  });

  router.post('/auth/login', handleAdminLogin(config));

  router.use(requireAdminAuth(config));

  router.get('/stats', async (_req, res, next) => {
    try {
      const db = await getDb();
      const [messageCount, failedCount, duplicateCount, processedCount, queueStats, dlqJobs] =
        await Promise.all([
          db.messages.countDocuments(),
          db.messages.countDocuments({ processingStatus: 'failed' }),
          db.messages.countDocuments({ processingStatus: 'duplicate' }),
          db.messages.countDocuments({ processingStatus: 'processed' }),
          getQueueStats(connection()),
          listDeadLetterJobs(connection(), 1),
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

  router.get('/metrics', async (_req, res, next) => {
    try {
      const db = await getDb();
      const [byStatus, queueStats, dlqJobs, eventsDispatched] = await Promise.all([
        db.messages
          .aggregate<{ _id: string; count: number }>([
            { $group: { _id: '$processingStatus', count: { $sum: 1 } } },
          ])
          .toArray(),
        getQueueStats(connection()),
        listDeadLetterJobs(connection(), 100),
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

  router.get('/messages', async (req, res, next) => {
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

  router.delete('/messages', async (req, res, next) => {
    try {
      const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined;
      const mailboxId = typeof req.query.mailboxId === 'string' ? req.query.mailboxId : undefined;
      if (!tenantId && !mailboxId) {
        res.status(400).json({ error: 'Provide tenantId and/or mailboxId query filter' });
        return;
      }
      const filter: Record<string, string> = {};
      if (tenantId) filter.tenantId = tenantId;
      if (mailboxId) filter.mailboxId = mailboxId;

      const db = await getDb();
      const messages = await db.messages.find(filter).toArray();
      let deleted = 0;
      for (const message of messages) {
        await deleteMessageRecord(db, storage, message._id, log);
        deleted++;
      }
      res.json({ ok: true, deleted, filter });
    } catch (err) {
      next(err);
    }
  });

  router.get('/messages/:id', async (req, res, next) => {
    try {
      const db = await getDb();
      const message = await db.messages.findOne({ _id: req.params.id });
      if (!message) return res.status(404).json({ error: 'Message not found' });
      res.json({ message });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/messages/:id', async (req, res, next) => {
    try {
      const db = await getDb();
      const message = await db.messages.findOne({ _id: req.params.id });
      if (!message) return res.status(404).json({ error: 'Message not found' });
      await deleteMessageRecord(db, storage, req.params.id, log);
      res.json({ ok: true, messageId: req.params.id });
    } catch (err) {
      next(err);
    }
  });

  router.post('/messages/:id/replay', async (req, res, next) => {
    try {
      res.json(await enqueueParseReplay(getDb, mimeParseQueue, config, req.params.id));
    } catch (err) {
      next(err);
    }
  });

  router.post('/messages/:id/redispatch-event', async (req, res, next) => {
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
        { messageId: message._id, tenantId: message.tenantId, mailboxId: message.mailboxId },
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

  router.get('/mailboxes', async (_req, res, next) => {
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

  router.delete('/mailboxes/:mailboxId', async (req, res, next) => {
    try {
      const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined;
      if (!tenantId) {
        res.status(400).json({ error: 'tenantId query parameter is required' });
        return;
      }
      const db = await getDb();
      const mailbox = await db.mailboxes.findOne({ _id: req.params.mailboxId, tenantId });
      if (!mailbox) return res.status(404).json({ error: 'Mailbox not found' });

      const messageCount = await db.messages.countDocuments({
        tenantId,
        mailboxId: req.params.mailboxId,
      });
      if (messageCount > 0) {
        res.status(409).json({
          error: 'Mailbox has messages — delete messages first',
          messageCount,
        });
        return;
      }

      await db.mailboxes.deleteOne({ _id: req.params.mailboxId, tenantId });
      log.info({ tenantId, mailboxId: req.params.mailboxId }, 'Mailbox deleted via admin');
      res.json({ ok: true, mailboxId: req.params.mailboxId, tenantId });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/tenants/:tenantId', async (req, res, next) => {
    try {
      const db = await getDb();
      const tenantId = req.params.tenantId;
      const [messageCount, mailboxCount] = await Promise.all([
        db.messages.countDocuments({ tenantId }),
        db.mailboxes.countDocuments({ tenantId }),
      ]);
      if (messageCount > 0 || mailboxCount > 0) {
        res.status(409).json({
          error: 'Tenant has mailboxes or messages — delete those first',
          messageCount,
          mailboxCount,
        });
        return;
      }
      const result = await db.tenants.deleteOne({ _id: tenantId });
      if (result.deletedCount === 0) return res.status(404).json({ error: 'Tenant not found' });
      log.info({ tenantId }, 'Tenant deleted via admin');
      res.json({ ok: true, tenantId });
    } catch (err) {
      next(err);
    }
  });

  router.get('/queues', async (_req, res, next) => {
    try {
      res.json({ queues: await getQueueStats(connection()) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/failures', async (_req, res, next) => {
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

  router.post('/failures/:id/retry', async (req, res, next) => {
    try {
      res.json(await enqueueParseReplay(getDb, mimeParseQueue, config, req.params.id));
    } catch (err) {
      next(err);
    }
  });

  router.get('/dlq', async (_req, res, next) => {
    try {
      res.json({ jobs: await listDeadLetterJobs(connection(), 100) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/dlq/:jobId/requeue', async (req, res, next) => {
    try {
      const result = await requeueDeadLetterJob(connection(), req.params.jobId, config);
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

  router.delete('/dlq/:jobId', async (req, res, next) => {
    try {
      await removeDeadLetterJob(connection(), req.params.jobId);
      log.info({ dlqJobId: req.params.jobId }, 'DLQ job deleted');
      res.json({ ok: true, jobId: req.params.jobId });
    } catch (err) {
      next(err);
    }
  });

  router.get('/logs', async (req, res, next) => {
    try {
      res.json(
        await queryLogs({
          limit: Number(req.query.limit) || 200,
          level: typeof req.query.level === 'string' ? req.query.level : undefined,
          messageId: typeof req.query.messageId === 'string' ? req.query.messageId : undefined,
          tenantId: typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined,
          service: typeof req.query.service === 'string' ? req.query.service : undefined,
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  return router;
}

async function enqueueParseReplay(
  getDb: () => Promise<DatabaseClient>,
  mimeParseQueue: ReturnType<typeof createQueue<MimeParseJob>>,
  config: Env,
  messageId: string,
) {
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
  await mimeParseQueue.add(
    'parse',
    {
      messageId: message._id,
      tenantId: message.tenantId,
      mailboxId: message.mailboxId,
      rawMimePath: message.rawMimePath,
    },
    { ...jobOptions(config), jobId: `${message._id}-replay-${Date.now()}` },
  );
  await db.messages.updateOne(
    { _id: message._id },
    { $set: { processingStatus: 'queued' }, $unset: { errorMessage: '', eventDispatchedAt: '' } },
  );
  return { ok: true as const, messageId: message._id, status: 'queued' as const };
}

async function deleteMessageRecord(
  db: DatabaseClient,
  storage: ReturnType<typeof createObjectStorage>,
  messageId: string,
  log: Logger,
): Promise<void> {
  const message = await db.messages.findOne({ _id: messageId });
  if (!message) return;

  const attachmentDocs = await db.attachments.find({ messageId }).toArray();
  const keys = new Set<string>();
  if (message.rawMimePath) keys.add(message.rawMimePath);
  for (const att of attachmentDocs) {
    if (att.storagePath) keys.add(att.storagePath);
  }
  for (const key of keys) {
    await storage.deleteObject(key).catch((err: unknown) => {
      log.warn({ err, key, messageId }, 'OCI delete failed (continuing)');
    });
  }

  await db.attachments.deleteMany({ messageId });
  await db.messages.deleteOne({ _id: messageId });
  log.info({ messageId, tenantId: message.tenantId }, 'Message deleted via admin');
}
