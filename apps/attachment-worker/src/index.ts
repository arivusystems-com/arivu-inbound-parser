import { Readable } from 'node:stream';
import path from 'node:path';
import { simpleParser } from 'mailparser';
import { ulid } from 'ulid';
import { loadConfig } from '@arivu/config';
import { connectDatabase } from '@arivu/database';
import { createLogger, childWithContext } from '@arivu/logger';
import {
  assertRedisReady,
  createDeadLetterQueue,
  createQueue,
  createRedisConnection,
  createWorkerWithDlq,
  jobOptions,
  toBullConnection,
  QUEUE_NAMES,
  type AttachmentProcessJob,
  type EventDispatchJob,
} from '@arivu/queue';
import { scanAttachmentPolicy } from '@arivu/security';
import { createObjectStorage } from '@arivu/storage';
import type { AttachmentMeta } from '@arivu/types';

const config = loadConfig();
const log = createLogger('attachment-worker');

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function extensionFromFilename(filename: string): string | undefined {
  const ext = path.extname(filename).replace(/^\./, '');
  return ext || undefined;
}

async function main() {
  await assertRedisReady(config.REDIS_URL).catch(() => {
    throw new Error(
      'Cannot connect to Redis — start infrastructure: pnpm infra:up (or docker compose up -d)',
    );
  });

  const database = await connectDatabase(config.MONGODB_URI);
  const storage = createObjectStorage(config);
  const redis = createRedisConnection(config.REDIS_URL, (err) => {
    log.warn({ err: err.message }, 'Redis connection error');
  });
  const eventQueue = createQueue<EventDispatchJob>(
    QUEUE_NAMES.EVENT_DISPATCH,
    toBullConnection(redis),
  );
  const deadLetterQueue = createDeadLetterQueue(toBullConnection(redis));

  createWorkerWithDlq<AttachmentProcessJob>(
    QUEUE_NAMES.ATTACHMENT_PROCESS,
    async (job) => {
      const { messageId, tenantId, rawMimePath } = job.data;
      const ctx = childWithContext(log, { messageId, tenantId, jobId: job.id });

      try {
        const rawStream = await storage.getRawMime(rawMimePath);
        const buffer = await streamToBuffer(rawStream);
        const parsed = await simpleParser(buffer);
        const mailAttachments = parsed.attachments ?? [];

        await database.attachments.deleteMany({ tenantId, messageId });
        const stored: AttachmentMeta[] = [];

        for (const att of mailAttachments) {
          const content = att.content;
          if (!content || content.length === 0) continue;

          if (content.length > config.MAX_ATTACHMENT_BYTES) {
            ctx.warn(
              { filename: att.filename, size: content.length },
              'Attachment exceeds MAX_ATTACHMENT_BYTES — skipped',
            );
            continue;
          }

          const filename = att.filename || 'unnamed';
          const mimeType = att.contentType || 'application/octet-stream';
          const policy = scanAttachmentPolicy({ filename, mimeType });
          if (!policy.allowed) {
            ctx.warn({ filename, reason: policy.reason }, 'Attachment blocked by policy');
            continue;
          }

          const attachmentId = `att_${ulid()}`;
          const storagePath = await storage.putAttachment(
            tenantId,
            attachmentId,
            content,
            mimeType,
          );

          const meta: AttachmentMeta = {
            _id: attachmentId,
            tenantId,
            messageId,
            filename,
            mimeType,
            extension: extensionFromFilename(filename),
            size: content.length,
            contentDisposition: att.contentDisposition,
            contentId: att.cid?.replace(/^<|>$/g, ''),
            storagePath,
          };

          await database.attachments.insertOne(meta);
          stored.push(meta);
        }

        await database.messages.updateOne(
          { _id: messageId },
          { $set: { attachments: stored, processingStatus: 'processed' } },
        );

        await eventQueue.add(
          'dispatch',
          { messageId, tenantId, mailboxId: job.data.mailboxId },
          {
            ...jobOptions(config),
            jobId: `email-received-${messageId}`,
          },
        );

        ctx.info({ count: stored.length }, 'Attachments processed; event queued');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Attachment processing failed';
        await database.messages.updateOne(
          { _id: messageId },
          { $set: { processingStatus: 'failed', errorMessage: message } },
        );
        ctx.error({ err }, 'Attachment processing failed');
        throw err;
      }
    },
    toBullConnection(redis),
    { config, deadLetterQueue },
  );

  log.info({ queue: QUEUE_NAMES.ATTACHMENT_PROCESS }, 'Attachment worker started');
}

main().catch((err) => {
  log.fatal({ err }, 'Attachment worker failed to start');
  process.exit(1);
});
