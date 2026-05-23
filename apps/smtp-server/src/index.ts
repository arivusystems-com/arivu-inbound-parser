import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { SMTPServer, type SMTPServerOptions } from 'smtp-server';
import { ulid } from 'ulid';
import { loadConfig } from '@arivu/config';
import { connectDatabase, seedDevData } from '@arivu/database';
import { createLogger, childWithContext } from '@arivu/logger';
import {
  assertRedisReady,
  createQueue,
  createRedisConnection,
  jobOptions,
  toBullConnection,
  QUEUE_NAMES,
} from '@arivu/queue';
import { parseRoutingAddress } from '@arivu/routing';
import {
  checkIpPolicy,
  Greylist,
  normalizeClientIp,
  parseIpList,
  RateLimiter,
} from '@arivu/security';
import { createObjectStorage } from '@arivu/storage';
import type { SmtpIngestJob } from '@arivu/types';
import { getSession } from './session.js';

const config = loadConfig();
const log = createLogger('smtp-server');

const ipAllowlist = parseIpList(config.SECURITY_IP_ALLOWLIST);
const ipBlocklist = parseIpList(config.SECURITY_IP_BLOCKLIST);

function isLocalIp(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === 'unknown';
}

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

  const rateLimiter = new RateLimiter(redis, {
    ipPerMinute: config.SECURITY_RATE_LIMIT_IP_PER_MIN,
    tenantPerMinute: config.SECURITY_RATE_LIMIT_TENANT_PER_MIN,
  });
  const greylist = config.SECURITY_GREYLIST_ENABLED
    ? new Greylist(redis, config.SECURITY_GREYLIST_TTL_SEC)
    : null;

  const serverOptions: SMTPServerOptions = {
    secure: false,
    disabledCommands: ['AUTH'],
    size: config.MAX_MESSAGE_BYTES,
    onConnect(session, callback) {
      const s = getSession(session);
      s.clientIp = normalizeClientIp(session.remoteAddress);
      const ipCheck = checkIpPolicy(s.clientIp, ipAllowlist, ipBlocklist);
      if (!ipCheck.allowed) {
        log.warn({ ip: s.clientIp, reason: ipCheck.reason }, 'Connection rejected');
        return callback(new Error(ipCheck.reason ?? 'Connection not allowed'));
      }
      void rateLimiter
        .checkIp(s.clientIp)
        .then(({ limited }) => {
          if (limited) {
            log.warn({ ip: s.clientIp }, 'IP rate limit exceeded');
            return callback(new Error('Rate limit exceeded — try again later'));
          }
          callback();
        })
        .catch((err) => callback(err instanceof Error ? err : new Error('Rate limit error')));
    },
    onMailFrom(address, session, callback) {
      const s = getSession(session);
      s.mailFrom = address.address;
      if (!greylist || isLocalIp(s.clientIp ?? '')) {
        return callback();
      }
      void greylist
        .shouldDefer(s.clientIp ?? 'unknown', address.address)
        .then((defer) => {
          if (defer) {
            log.info({ ip: s.clientIp, from: address.address }, 'Greylisted — defer');
            return callback(new Error('Greylisted — try again in a few minutes'));
          }
          callback();
        })
        .catch((err) => callback(err instanceof Error ? err : new Error('Greylist error')));
    },
    onRcptTo(address, session, callback) {
      const s = getSession(session);
      const routing = parseRoutingAddress(address.address);
      if (!routing) {
        log.warn({ to: address.address }, 'Invalid routing address');
        return callback(new Error('Invalid recipient'));
      }
      s.routing = routing;
      void rateLimiter
        .checkTenant(routing.tenantId)
        .then(({ limited }) => {
          if (limited) {
            log.warn({ tenantId: routing.tenantId }, 'Tenant rate limit exceeded');
            return callback(new Error('Tenant rate limit exceeded'));
          }
          callback();
        })
        .catch((err) => callback(err instanceof Error ? err : new Error('Rate limit error')));
    },
    async onData(stream, session, callback) {
      const s = getSession(session);
      const routing = s.routing;
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
          { maxBytes: config.MAX_MESSAGE_BYTES },
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
          clientIp: s.clientIp,
        });

        const job: SmtpIngestJob = {
          messageId,
          tenantId: routing.tenantId,
          mailboxId: routing.mailboxId,
          rawMimePath,
        };

        await mimeParseQueue.add('parse', job, {
          ...jobOptions(config),
          jobId: messageId,
        });

        await database.messages.updateOne(
          { _id: messageId },
          { $set: { processingStatus: 'queued' } },
        );

        ctx.info({ rawMimePath, clientIp: s.clientIp }, 'Message ingested and queued');
        callback();
      } catch (err) {
        ctx.error({ err }, 'SMTP ingest failed');
        callback(err instanceof Error ? err : new Error('Ingest failed'));
      }
    },
  };

  if (config.SMTP_TLS_ENABLED) {
    if (!config.SMTP_TLS_KEY_PATH || !config.SMTP_TLS_CERT_PATH) {
      throw new Error('SMTP_TLS_ENABLED requires SMTP_TLS_KEY_PATH and SMTP_TLS_CERT_PATH');
    }
    serverOptions.key = readFileSync(config.SMTP_TLS_KEY_PATH);
    serverOptions.cert = readFileSync(config.SMTP_TLS_CERT_PATH);
    log.info('STARTTLS enabled for SMTP');
  }

  const server = new SMTPServer(serverOptions);

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
      {
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        domain: config.SMTP_DOMAIN,
        authMode: config.SECURITY_AUTH_MODE,
        greylist: Boolean(greylist),
        tls: Boolean(config.SMTP_TLS_ENABLED),
      },
      'SMTP server listening',
    );
  });
}

main().catch((err) => {
  log.fatal({ err }, 'SMTP server failed to start');
  process.exit(1);
});
