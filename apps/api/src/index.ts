import cors from 'cors';
import express from 'express';
import { loadConfig } from '@arivu/config';
import { connectDatabase } from '@arivu/database';
import { createLogger } from '@arivu/logger';
import {
  createQueue,
  createRedisConnection,
  getQueueStats,
  toBullConnection,
  QUEUE_NAMES,
} from '@arivu/queue';
import type { MimeParseJob } from '@arivu/types';

const config = loadConfig();
const log = createLogger('api');
const redis = createRedisConnection(config.REDIS_URL, (err) => {
  log.warn({ err: err.message }, 'Redis connection error — is Docker running? (pnpm infra:up)');
});
const mimeParseQueue = createQueue<MimeParseJob>(QUEUE_NAMES.MIME_PARSE, toBullConnection(redis));

let database: Awaited<ReturnType<typeof connectDatabase>> | null = null;

async function getDb() {
  if (!database) database = await connectDatabase(config.MONGODB_URI);
  return database;
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api' });
});

app.get('/admin/stats', async (_req, res, next) => {
  try {
    const db = await getDb();
    const [messageCount, failedCount, queueStats] = await Promise.all([
      db.messages.countDocuments(),
      db.messages.countDocuments({ processingStatus: 'failed' }),
      getQueueStats(toBullConnection(redis)),
    ]);
    const last = await db.messages.find().sort({ receivedAt: -1 }).limit(1).toArray();
    res.json({
      messagesTotal: messageCount,
      messagesFailed: failedCount,
      queues: queueStats,
      lastMessage: last[0] ?? null,
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

app.post('/admin/messages/:id/replay', async (req, res, next) => {
  try {
    const db = await getDb();
    const message = await db.messages.findOne({ _id: req.params.id });
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (!message.rawMimePath) {
      return res.status(400).json({ error: 'Message has no raw MIME path — cannot replay' });
    }

    const job: MimeParseJob = {
      messageId: message._id,
      tenantId: message.tenantId,
      mailboxId: message.mailboxId,
      rawMimePath: message.rawMimePath,
    };

    await mimeParseQueue.add('parse', job, {
      jobId: `${message._id}-replay-${Date.now()}`,
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });

    await db.messages.updateOne(
      { _id: message._id },
      { $set: { processingStatus: 'queued' }, $unset: { errorMessage: '' } },
    );

    log.info({ messageId: message._id }, 'Parse replay enqueued');
    res.json({ ok: true, messageId: message._id, status: 'queued' });
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
      .find({ processingStatus: 'failed' })
      .sort({ receivedAt: -1 })
      .limit(100)
      .toArray();
    res.json({ failures });
  } catch (err) {
    next(err);
  }
});

app.get('/admin/logs', (_req, res) => {
  res.json({
    logs: [],
    note: 'Log aggregation not wired yet — use service stdout in development',
  });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.error({ err }, 'API error');
  res.status(500).json({ error: err.message });
});

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
