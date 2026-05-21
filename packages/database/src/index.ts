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
    client = new MongoClient(uri);
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

export async function seedDevData(database: DatabaseClient): Promise<void> {
  const tenantId = 't_123';
  const mailboxId = 'm_45';
  const routingAddress = `support+${tenantId}_${mailboxId}@reply.arivusystems.com`;

  await database.tenants.updateOne(
    { _id: tenantId },
    { $set: { _id: tenantId, name: 'Acme Inc (dev)' } },
    { upsert: true },
  );

  await database.mailboxes.updateOne(
    { _id: mailboxId },
    {
      $set: {
        _id: mailboxId,
        tenantId,
        type: 'shared',
        name: 'Support',
        routingAddress,
      },
    },
    { upsert: true },
  );
}

export type { Db, Collection, Document };
