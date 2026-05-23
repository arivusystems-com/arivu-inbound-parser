import { ulid } from 'ulid';
import type { EmailAddress, InternalMessage } from '@arivu/types';
import type { DatabaseClient } from '@arivu/database';

export interface ThreadResolveInput {
  tenantId: string;
  mailboxId: string;
  subject: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  headers: Record<string, string | string[]>;
  receivedAt: string;
}

function headerValue(headers: Record<string, string | string[]>, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) return undefined;
  const val = headers[key];
  const raw = Array.isArray(val) ? val[0] : val;
  return raw?.trim() || undefined;
}

function normalizeMessageId(id: string): string[] {
  const trimmed = id.trim();
  if (!trimmed) return [];
  const bare = trimmed.replace(/^<|>$/g, '');
  return [`<${bare}>`, bare, trimmed];
}

export function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(re|fwd|fw):\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function uniqueParticipants(...groups: EmailAddress[][]): EmailAddress[] {
  const seen = new Set<string>();
  const out: EmailAddress[] = [];
  for (const group of groups) {
    for (const a of group) {
      const key = a.address.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(a);
    }
  }
  return out;
}

async function findMessageByExternalId(
  database: DatabaseClient,
  tenantId: string,
  mailboxId: string,
  externalId: string,
): Promise<InternalMessage | null> {
  const variants = normalizeMessageId(externalId);
  if (variants.length === 0) return null;
  return database.messages.findOne({
    tenantId,
    mailboxId,
    messageId: { $in: variants },
  });
}

async function findThreadFromReferences(
  database: DatabaseClient,
  tenantId: string,
  mailboxId: string,
  references: string,
): Promise<string | null> {
  const ids = references.split(/\s+/).filter(Boolean);
  for (const ref of ids.reverse()) {
    const parent = await findMessageByExternalId(database, tenantId, mailboxId, ref);
    if (parent?.threadId) return parent.threadId;
  }
  return null;
}

async function findThreadBySubjectFallback(
  database: DatabaseClient,
  tenantId: string,
  mailboxId: string,
  subject: string,
): Promise<string | null> {
  const normalized = normalizeSubject(subject);
  if (!normalized) return null;

  const recent = await database.messages
    .find({ tenantId, mailboxId, threadId: { $exists: true, $ne: '' } })
    .sort({ receivedAt: -1 })
    .limit(200)
    .toArray();

  for (const msg of recent) {
    if (normalizeSubject(msg.subject) === normalized && msg.threadId) {
      return msg.threadId;
    }
  }
  return null;
}

async function upsertThread(
  database: DatabaseClient,
  threadId: string,
  input: ThreadResolveInput,
): Promise<void> {
  const participants = uniqueParticipants([input.from], input.to, input.cc ?? []);
  await database.threads.updateOne(
    { _id: threadId, tenantId: input.tenantId },
    {
      $set: {
        subject: input.subject,
        participants,
        lastMessageAt: input.receivedAt,
      },
      $setOnInsert: {
        _id: threadId,
        tenantId: input.tenantId,
      },
    },
    { upsert: true },
  );
}

/** Resolve or create thread; returns threadId. */
export async function resolveThreadId(
  database: DatabaseClient,
  input: ThreadResolveInput,
): Promise<string> {
  const { headers, tenantId, mailboxId } = input;

  const arivuThread = headerValue(headers, 'X-Arivu-Thread');
  if (arivuThread) {
    const existing = await database.threads.findOne({ _id: arivuThread, tenantId });
    if (existing) {
      await upsertThread(database, arivuThread, input);
      return arivuThread;
    }
  }

  const arivuMessage = headerValue(headers, 'X-Arivu-Message');
  if (arivuMessage) {
    const parent = await findMessageByExternalId(database, tenantId, mailboxId, arivuMessage);
    if (parent?.threadId) {
      await upsertThread(database, parent.threadId, input);
      return parent.threadId;
    }
  }

  const inReplyTo = headerValue(headers, 'In-Reply-To');
  if (inReplyTo) {
    const parent = await findMessageByExternalId(database, tenantId, mailboxId, inReplyTo);
    if (parent?.threadId) {
      await upsertThread(database, parent.threadId, input);
      return parent.threadId;
    }
  }

  const references = headerValue(headers, 'References');
  if (references) {
    const fromRefs = await findThreadFromReferences(database, tenantId, mailboxId, references);
    if (fromRefs) {
      await upsertThread(database, fromRefs, input);
      return fromRefs;
    }
  }

  const fromSubject = await findThreadBySubjectFallback(database, tenantId, mailboxId, input.subject);
  if (fromSubject) {
    await upsertThread(database, fromSubject, input);
    return fromSubject;
  }

  const threadId = `thr_${ulid()}`;
  await upsertThread(database, threadId, input);
  return threadId;
}

export { headerValue, normalizeMessageId, findMessageByExternalId };
