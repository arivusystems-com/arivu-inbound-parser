export interface MessageSummary {
  _id: string;
  subject: string;
  from: { address: string; name?: string };
  processingStatus: string;
  receivedAt: string;
  tenantId: string;
  mailboxId: string;
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
  attachments: unknown[];
}

export function statusClass(status: string): string {
  if (status === 'processed') return 'badge badge-ok';
  if (status === 'failed') return 'badge badge-fail';
  if (status === 'queued' || status === 'parsing') return 'badge badge-warn';
  return 'badge';
}
