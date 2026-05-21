export type ProcessingStatus =
  | 'received'
  | 'raw_stored'
  | 'queued'
  | 'parsing'
  | 'processed'
  | 'failed';

export type MailboxType = 'shared' | 'private';

export type MessageDirection = 'inbound' | 'outbound';

export interface EmailAddress {
  name?: string;
  address: string;
}

export interface RoutingAddress {
  tenantId: string;
  mailboxId: string;
  localPart: string;
  domain: string;
  raw: string;
}

export interface Tenant {
  _id: string;
  name: string;
}

export interface Mailbox {
  _id: string;
  tenantId: string;
  type: MailboxType;
  name: string;
  routingAddress: string;
}

export interface AttachmentMeta {
  _id: string;
  tenantId: string;
  messageId: string;
  filename: string;
  mimeType: string;
  extension?: string;
  size: number;
  contentDisposition?: string;
  contentId?: string;
  storagePath: string;
}

export interface InternalMessage {
  _id: string;
  tenantId: string;
  mailboxId: string;
  direction: MessageDirection;
  messageId: string;
  subject: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  replyTo: EmailAddress[];
  headers: Record<string, string | string[]>;
  htmlBody?: string;
  textBody?: string;
  attachments: AttachmentMeta[];
  rawMimePath: string;
  threadId?: string;
  receivedAt: string;
  processingStatus: ProcessingStatus;
  errorMessage?: string;
}

export interface Thread {
  _id: string;
  tenantId: string;
  subject: string;
  participants: EmailAddress[];
  lastMessageAt: string;
}

export interface SmtpIngestJob {
  messageId: string;
  tenantId: string;
  mailboxId: string;
  rawMimePath: string;
}

export interface MimeParseJob {
  messageId: string;
  tenantId: string;
  mailboxId: string;
  rawMimePath: string;
}

export const QUEUE_NAMES = {
  SMTP_INGEST: 'smtp-ingest',
  MIME_PARSE: 'mime-parse',
  ATTACHMENT_PROCESS: 'attachment-process',
  EVENT_DISPATCH: 'event-dispatch',
  DEAD_LETTER: 'dead-letter',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
