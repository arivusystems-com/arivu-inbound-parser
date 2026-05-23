import type { MailboxType } from '@arivu/types';

export const TENANT_ID_PATTERN = /^t_[a-zA-Z0-9_-]+$/;
export const MAILBOX_ID_PATTERN = /^m_[a-zA-Z0-9_-]+$/;
export const LOCAL_PART_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export class ValidationError extends Error {
  readonly statusCode = 400;
}

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${field} is required`);
  }
  return value.trim();
}

function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

export interface ProvisionMailboxBody {
  tenantId: string;
  tenantName: string;
  mailboxId: string;
  mailboxName: string;
  routingLocalPart: string;
  mailboxType: MailboxType;
}

export function parseProvisionMailboxBody(body: unknown): ProvisionMailboxBody {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('JSON body required');
  }
  const record = body as Record<string, unknown>;

  const tenantId = requireString(record, 'tenantId');
  const mailboxId = requireString(record, 'mailboxId');
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw new ValidationError('tenantId must match t_<id> (e.g. t_xyz)');
  }
  if (!MAILBOX_ID_PATTERN.test(mailboxId)) {
    throw new ValidationError('mailboxId must match m_<id> (e.g. m_support)');
  }

  const tenantName = optionalString(record, 'tenantName') ?? tenantId;
  const mailboxName = optionalString(record, 'mailboxName') ?? 'Inbox';
  const routingLocalPart = optionalString(record, 'routingLocalPart') ?? 'support';
  if (!LOCAL_PART_PATTERN.test(routingLocalPart)) {
    throw new ValidationError('routingLocalPart is invalid');
  }

  const typeRaw = optionalString(record, 'type') ?? optionalString(record, 'mailboxType') ?? 'shared';
  if (typeRaw !== 'shared' && typeRaw !== 'private') {
    throw new ValidationError('type must be shared or private');
  }

  return {
    tenantId,
    tenantName,
    mailboxId,
    mailboxName,
    routingLocalPart,
    mailboxType: typeRaw,
  };
}

export interface ProvisionTenantBody {
  tenantId: string;
  tenantName: string;
}

export function parseProvisionTenantBody(body: unknown): ProvisionTenantBody {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('JSON body required');
  }
  const record = body as Record<string, unknown>;
  const tenantId = requireString(record, 'tenantId');
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw new ValidationError('tenantId must match t_<id> (e.g. t_xyz)');
  }
  const tenantName = optionalString(record, 'tenantName') ?? tenantId;
  return { tenantId, tenantName };
}
