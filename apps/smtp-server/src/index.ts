import { Readable } from 'node:stream';
import { SMTPServer } from 'smtp-server';
import { ulid } from 'ulid';
import { loadConfig } from '@arivu/config';
import { connectDatabase, seedDevData } from '@arivu/database';
import { createLogger, childWithContext } from '@arivu/logger';
import {
  assertRedisReady,
  createQueue,
  createRedisConnection,
  toBullConnection,
  QUEUE_NAMES,
} from '@arivu/queue';
import { parseRoutingAddress } from '@arivu/routing';
import { createObjectStorage } from '@arivu/storage';
import type { SmtpIngestJob } from '@arivu/types';

const config = loadConfig();
const log = createLogger('smtp-server');

async function main() {
  await assertRedisReady(config.REDIS_URL).catch(() => {
    throw new Error(
      'Cannot connect to Redis — start infrastructure: pnpm infra:up (or docker compose up -d)',
    );
  });

  const database = await connectDatabase(config.MONGODB_URI);

  if (config.NODE_ENV === 'development') {
    await seedDevData(database);
    log.info('Dev tenant/mailbox ensured (t_123 / m_45)');
  }

  const storage = createObjectStorage(config);
  const redis = createRedisConnection(config.REDIS_URL, (err) => {
    log.warn({ err: err.message }, 'Redis connection error');
  });
  const mimeParseQueue = createQueue<SmtpIngestJob>(
    QUEUE_NAMES.MIME_PARSE,
    toBullConnection(redis),
  );

  const server = new SMTPServer({
    secure: false,
    disabledCommands: ['AUTH'],
    size: config.MAX_MESSAGE_BYTES,
    onMailFrom(address, _session, callback) {
      log.debug({ from: address.address }, 'MAIL FROM');
      callback();
    },
    onRcptTo(address, session, callback) {
      const routing = parseRoutingAddress(address.address);
      if (!routing) {
        log.warn({ to: address.address }, 'Invalid routing address');
        return callback(new Error('Invalid recipient'));
      }
      session.routing = routing;
      callback();
    },
    async onData(stream, session, callback) {
      const routing = session.routing;
      if (!routing) return callback(new Error('No routing context'));

      const messageId = `msg_${ulid()}`;
      const ctx = childWithContext(log, {
        messageId,
        tenantId: routing.tenantId,
        mailboxId: routing.mailboxId,
        correlationId: messageId,
      });

      try {
        const mailbox = await database.mailboxes.findOne({
          _id: routing.mailboxId,
          tenantId: routing.tenantId,
        });
        if (!mailbox) {
          ctx.warn(
            { recipient: routing.raw },
            'Mailbox not found — run pnpm seed or check Mailboxes in admin UI',
          );
          return callback(new Error('Unknown mailbox'));
        }

        const rawMimePath = await storage.putRawMime(
          routing.tenantId,
          messageId,
          stream as unknown as Readable,
        );

        const receivedAt = new Date().toISOString();
        await database.messages.insertOne({
          _id: messageId,
          tenantId: routing.tenantId,
          mailboxId: routing.mailboxId,
          direction: 'inbound',
          messageId: '',
          subject: '',
          from: { address: '' },
          to: [],
          cc: [],
          bcc: [],
          replyTo: [],
          headers: {},
          attachments: [],
          rawMimePath,
          receivedAt,
          processingStatus: 'raw_stored',
        });

        const job: SmtpIngestJob = {
          messageId,
          tenantId: routing.tenantId,
          mailboxId: routing.mailboxId,
          rawMimePath,
        };

        await mimeParseQueue.add('parse', job, {
          jobId: messageId,
          removeOnComplete: 1000,
          removeOnFail: 5000,
        });

        await database.messages.updateOne(
          { _id: messageId },
          { $set: { processingStatus: 'queued' } },
        );

        ctx.info({ rawMimePath }, 'Message ingested and queued');
        callback();
      } catch (err) {
        ctx.error({ err }, 'SMTP ingest failed');
        callback(err instanceof Error ? err : new Error('Ingest failed'));
      }
    },
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log.fatal({ port: config.SMTP_PORT }, 'Port already in use — run: pnpm dev:stop');
      process.exit(1);
    }
    log.fatal({ err }, 'SMTP server error');
    process.exit(1);
  });

  server.listen(config.SMTP_PORT, config.SMTP_HOST, () => {
    log.info(
      { host: config.SMTP_HOST, port: config.SMTP_PORT, domain: config.SMTP_DOMAIN },
      'SMTP server listening',
    );
  });
}

main().catch((err) => {
  log.fatal({ err }, 'SMTP server failed to start');
  process.exit(1);
});
