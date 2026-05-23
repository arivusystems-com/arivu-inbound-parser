import { Readable } from 'node:stream';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
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
  type MimeParseJob,
  type EventDispatchJob,
} from '@arivu/queue';
import { createObjectStorage } from '@arivu/storage';
import { shouldRejectAuth, verifyEmailAuth } from '@arivu/security';
import { findMessageByExternalId, resolveThreadId } from '@arivu/threading';
import type { AttachmentProcessJob, EmailAddress } from '@arivu/types';

const config = loadConfig();
const log = createLogger('parser-worker');

function enqueueEmailReceived(
  queue: ReturnType<typeof createQueue<EventDispatchJob>>,
  data: EventDispatchJob,
): Promise<unknown> {
  return queue.add('dispatch', data, {
    ...jobOptions(config),
    jobId: `email-received-${data.messageId}`,
  });
}

function toAddresses(value: AddressObject | AddressObject[] | undefined): EmailAddress[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((group) =>
    (group.value ?? []).map((a) => ({
      name: a.name || undefined,
      address: a.address || '',
    })),
  );
}

function toSingleAddress(value: AddressObject | undefined): EmailAddress {
  const list = toAddresses(value);
  return list[0] ?? { address: '' };
}

function headersToRecord(mail: ParsedMail): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (!mail.headers) return out;
  for (const [key, val] of mail.headers) {
    if (typeof val === 'string') out[key] = val;
    else if (Array.isArray(val)) out[key] = val.map(String);
    else if (val != null) out[key] = String(val);
  }
  return out;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function main() {
  await assertRedisReady(config.REDIS_URL).catch(() => {
    throw new Error(
      'Cannot connect to Redis at ' +
        config.REDIS_URL +
        ' — start infrastructure: pnpm infra:up (or docker compose up -d)',
    );
  });

  const database = await connectDatabase(config.MONGODB_URI);
  const storage = createObjectStorage(config);
  const redis = createRedisConnection(config.REDIS_URL, (err) => {
    log.warn({ err: err.message }, 'Redis connection error');
  });
  const attachmentQueue = createQueue<AttachmentProcessJob>(
    QUEUE_NAMES.ATTACHMENT_PROCESS,
    toBullConnection(redis),
  );
  const eventQueue = createQueue<EventDispatchJob>(
    QUEUE_NAMES.EVENT_DISPATCH,
    toBullConnection(redis),
  );
  const deadLetterQueue = createDeadLetterQueue(toBullConnection(redis));

  createWorkerWithDlq<MimeParseJob>(
    QUEUE_NAMES.MIME_PARSE,
    async (job) => {
      const { messageId, tenantId, mailboxId, rawMimePath } = job.data;
      const ctx = childWithContext(log, { messageId, tenantId, mailboxId, jobId: job.id });

      await database.messages.updateOne(
        { _id: messageId },
        { $set: { processingStatus: 'parsing' } },
      );

      try {
        const rawStream = await storage.getRawMime(rawMimePath);
        const buffer = await streamToBuffer(rawStream);
        const parsed = await simpleParser(buffer);

        const existingEarly = await database.messages.findOne({ _id: messageId });
        const mailFromAddr = parsed.from?.value?.[0]?.address;
        const authResults = await verifyEmailAuth({
          rawMime: buffer,
          clientIp: existingEarly?.clientIp,
          mailFrom: mailFromAddr,
          mode: config.SECURITY_AUTH_MODE,
        });

        if (shouldRejectAuth(authResults)) {
          await database.messages.updateOne(
            { _id: messageId },
            {
              $set: {
                processingStatus: 'failed',
                errorMessage: `Authentication rejected: ${authResults.summary}`,
                authResults,
              },
            },
          );
          ctx.warn({ auth: authResults.summary }, 'Email authentication rejected');
          return;
        }

        const externalMessageId =
          typeof parsed.messageId === 'string' ? parsed.messageId : String(parsed.messageId ?? '');

        if (externalMessageId) {
          const duplicate = await findMessageByExternalId(
            database,
            tenantId,
            mailboxId,
            externalMessageId,
          );
          if (duplicate && duplicate._id !== messageId) {
            await database.messages.updateOne(
              { _id: messageId },
              {
                $set: {
                  messageId: externalMessageId,
                  processingStatus: 'duplicate',
                  errorMessage: `Duplicate of ${duplicate._id}`,
                },
              },
            );
            ctx.warn({ duplicateOf: duplicate._id }, 'Duplicate RFC Message-ID — skipped');
            return;
          }
        }

        const headers = headersToRecord(parsed);
        const from = toSingleAddress(parsed.from);
        const to = toAddresses(parsed.to);
        const cc = toAddresses(parsed.cc);

        const existing = await database.messages.findOne({ _id: messageId });
        const receivedAt = existing?.receivedAt ?? new Date().toISOString();

        const threadId = await resolveThreadId(database, {
          tenantId,
          mailboxId,
          subject: parsed.subject ?? '',
          from,
          to,
          cc,
          headers,
          receivedAt,
        });

        const attachmentCount = parsed.attachments?.length ?? 0;
        const nextStatus = attachmentCount > 0 ? 'attachments_pending' : 'processed';

        await database.messages.updateOne(
          { _id: messageId },
          {
            $set: {
              messageId: externalMessageId,
              subject: parsed.subject ?? '',
              from,
              to,
              cc,
              bcc: toAddresses(parsed.bcc),
              replyTo: toAddresses(parsed.replyTo),
              headers,
              htmlBody: parsed.html || undefined,
              textBody: parsed.text || undefined,
              threadId,
              processingStatus: nextStatus,
              attachments: [],
              authResults,
            },
          },
        );

        if (attachmentCount > 0) {
          await attachmentQueue.add(
            'process',
            { messageId, tenantId, mailboxId, rawMimePath },
            {
              ...jobOptions(config),
              jobId: `${messageId}-att-${Date.now()}`,
            },
          );
          ctx.info({ subject: parsed.subject, threadId, attachmentCount }, 'Parsed; attachments queued');
        } else {
          await enqueueEmailReceived(eventQueue, { messageId, tenantId, mailboxId });
          ctx.info({ subject: parsed.subject, threadId }, 'Message parsed; event queued');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Parse failed';
        await database.messages.updateOne(
          { _id: messageId },
          { $set: { processingStatus: 'failed', errorMessage: message } },
        );
        ctx.error({ err }, 'Parse failed');
        throw err;
      }
    },
    toBullConnection(redis),
    { config, deadLetterQueue },
  );

  log.info({ queue: QUEUE_NAMES.MIME_PARSE }, 'Parser worker started');
}

main().catch((err) => {
  log.fatal({ err }, 'Parser worker failed to start');
  process.exit(1);
});
