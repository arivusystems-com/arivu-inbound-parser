import { MongoClient, type Db, type Collection, type Document } from 'mongodb';
import type { InternalMessage, Mailbox, Tenant, Thread, AttachmentMeta } from '@arivu/types';

export interface DatabaseClient {
  db: Db;
  tenants: Collection<Tenant>;
  mailboxes: Collection<Mailbox>;
  messages: Collection<InternalMessage>;
  threads: Collection<Thread>;
  attachments: Collection<AttachmentMeta>;
  close(): Promise<void>;
}

let client: MongoClient | null = null;
let indexesEnsured = false;

function createMongoClient(uri: string): MongoClient {
  return new MongoClient(uri, {
    serverSelectionTimeoutMS: 15_000,
    connectTimeoutMS: 15_000,
    socketTimeoutMS: 45_000,
    heartbeatFrequencyMS: 10_000,
    maxIdleTimeMS: 60_000,
    maxPoolSize: 20,
  });
}

/** Verify MongoDB is reachable; reconnect if the pooled connection went stale. */
export async function ensureMongoConnected(uri: string): Promise<MongoClient> {
  if (client) {
    try {
      await client.db().admin().ping();
      return client;
    } catch {
      await client.close().catch(() => undefined);
      client = null;
      indexesEnsured = false;
    }
  }

  client = createMongoClient(uri);
  await client.connect();
  return client;
}

export async function pingDatabase(): Promise<void> {
  if (!client) {
    throw new Error('MongoDB not connected');
  }
  await client.db().admin().ping();
}

export interface ConnectionMonitorOptions {
  intervalMs?: number;
  maxConsecutiveFailures?: number;
  onFailure?: (err: Error, failures: number) => void;
  onGiveUp?: (err: Error) => void;
}

/** Periodically ping MongoDB; reconnect on failure, exit after repeated failures. */
export function startMongoConnectionMonitor(
  uri: string,
  options: ConnectionMonitorOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? 60_000;
  const maxFailures = options.maxConsecutiveFailures ?? 3;
  let consecutiveFailures = 0;

  const timer = setInterval(() => {
    void ensureMongoConnected(uri)
      .then(() => {
        consecutiveFailures = 0;
      })
      .catch((err: Error) => {
        consecutiveFailures += 1;
        options.onFailure?.(err, consecutiveFailures);
        if (consecutiveFailures >= maxFailures) {
          clearInterval(timer);
          options.onGiveUp?.(err);
        }
      });
  }, intervalMs);
  timer.unref();

  return () => clearInterval(timer);
}

export async function connectDatabase(uri: string): Promise<DatabaseClient> {
  await ensureMongoConnected(uri);

  const db = client!.db();
  const messages = db.collection<InternalMessage>('messages');
  const mailboxes = db.collection<Mailbox>('mailboxes');
  const threads = db.collection<Thread>('threads');

  if (!indexesEnsured) {
    await Promise.all([
      messages.createIndex({ tenantId: 1 }),
      messages.createIndex({ mailboxId: 1 }),
      messages.createIndex({ messageId: 1 }),
      messages.createIndex(
        { mailboxId: 1, messageId: 1 },
        {
          unique: true,
          partialFilterExpression: { messageId: { $type: 'string', $gt: '' } },
        },
      ),
      messages.createIndex({ threadId: 1 }),
      messages.createIndex({ receivedAt: -1 }),
      mailboxes.createIndex({ tenantId: 1 }),
      mailboxes.createIndex({ routingAddress: 1 }, { unique: true }),
      threads.createIndex({ tenantId: 1 }),
      threads.createIndex({ lastMessageAt: -1 }),
    ]);
    indexesEnsured = true;
  }

  return {
    db,
    tenants: db.collection<Tenant>('tenants'),
    mailboxes,
    messages,
    threads: db.collection<Thread>('threads'),
    attachments: db.collection<AttachmentMeta>('attachments'),
    close: async () => {
      if (client) {
        await client.close();
        client = null;
      }
    },
  };
}

export interface SeedTenantMailboxInput {
  tenantId: string;
  tenantName: string;
  mailboxId: string;
  mailboxName: string;
  routingAddress: string;
  mailboxType?: Mailbox['type'];
}

/** Upsert one tenant and mailbox (idempotent). Used by dev and production seed scripts. */
export async function seedTenantMailbox(
  database: DatabaseClient,
  input: SeedTenantMailboxInput,
): Promise<void> {
  await database.tenants.updateOne(
    { _id: input.tenantId },
    { $set: { _id: input.tenantId, name: input.tenantName } },
    { upsert: true },
  );

  await database.mailboxes.updateOne(
    { _id: input.mailboxId },
    {
      $set: {
        _id: input.mailboxId,
        tenantId: input.tenantId,
        type: input.mailboxType ?? 'shared',
        name: input.mailboxName,
        routingAddress: input.routingAddress,
      },
    },
    { upsert: true },
  );
}

export async function seedDevData(database: DatabaseClient): Promise<void> {
  const tenantId = 't_123';
  const mailboxId = 'm_45';
  const routingAddress = `support+${tenantId}_${mailboxId}@reply.arivusystems.com`;

  await seedTenantMailbox(database, {
    tenantId,
    tenantName: 'Acme Inc (dev)',
    mailboxId,
    mailboxName: 'Support',
    routingAddress,
    mailboxType: 'shared',
  });
}

export type { Db, Collection, Document };
