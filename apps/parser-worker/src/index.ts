import { Readable } from 'node:stream';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import { loadConfig } from '@arivu/config';
import { connectDatabase } from '@arivu/database';
import { createLogger, childWithContext } from '@arivu/logger';
import {
  assertRedisReady,
  createRedisConnection,
  createWorker,
  toBullConnection,
  QUEUE_NAMES,
  type MimeParseJob,
} from '@arivu/queue';
import { createObjectStorage } from '@arivu/storage';
import type { EmailAddress } from '@arivu/types';

const config = loadConfig();
const log = createLogger('parser-worker');

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

  createWorker<MimeParseJob>(
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

        const externalMessageId =
          typeof parsed.messageId === 'string' ? parsed.messageId : String(parsed.messageId ?? '');

        await database.messages.updateOne(
          { _id: messageId },
          {
            $set: {
              messageId: externalMessageId,
              subject: parsed.subject ?? '',
              from: toSingleAddress(parsed.from),
              to: toAddresses(parsed.to),
              cc: toAddresses(parsed.cc),
              bcc: toAddresses(parsed.bcc),
              replyTo: toAddresses(parsed.replyTo),
              headers: headersToRecord(parsed),
              htmlBody: parsed.html || undefined,
              textBody: parsed.text || undefined,
              processingStatus: 'processed',
            },
          },
        );

        ctx.info({ subject: parsed.subject }, 'Message parsed');
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
  );

  log.info({ queue: QUEUE_NAMES.MIME_PARSE }, 'Parser worker started');
}

main().catch((err) => {
  log.fatal({ err }, 'Parser worker failed to start');
  process.exit(1);
});
