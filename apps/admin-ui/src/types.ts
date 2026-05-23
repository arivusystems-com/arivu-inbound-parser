export interface MessageSummary {
  _id: string;
  subject: string;
  from: { address: string; name?: string };
  processingStatus: string;
  receivedAt: string;
  tenantId: string;
  mailboxId: string;
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

export interface MessageDetail extends MessageSummary {
  messageId: string;
  direction: string;
  to: { address: string; name?: string }[];
  cc: { address: string; name?: string }[];
  bcc: { address: string; name?: string }[];
  replyTo: { address: string; name?: string }[];
  headers: Record<string, string | string[]>;
  htmlBody?: string;
  textBody?: string;
  rawMimePath: string;
  threadId?: string;
  errorMessage?: string;
  attachments: AttachmentMeta[];
  eventDispatchedAt?: string;
  clientIp?: string;
  authResults?: {
    checkedAt: string;
    mode: string;
    spf: { result: string; domain?: string };
    dkim: { result: string; domains?: string[] };
    dmarc: { result: string; policy?: string; aligned?: boolean };
    overall: string;
    summary: string;
  };
}

export function statusClass(status: string): string {
  if (status === 'processed') return 'badge badge-ok';
  if (status === 'failed') return 'badge badge-fail';
  if (status === 'duplicate') return 'badge badge-warn';
  if (status === 'queued' || status === 'parsing' || status === 'attachments_pending') {
    return 'badge badge-warn';
  }
  return 'badge';
}
