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

export async function connectDatabase(uri: string): Promise<DatabaseClient> {
  if (!client) {
    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 15_000,
      connectTimeoutMS: 15_000,
    });
    await client.connect();
  }

  const db = client.db();
  const messages = db.collection<InternalMessage>('messages');
  const mailboxes = db.collection<Mailbox>('mailboxes');
  const threads = db.collection<Thread>('threads');

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
