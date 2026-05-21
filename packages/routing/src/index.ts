import type { RoutingAddress } from '@arivu/types';

/** Matches local parts like support+t_123_m_45 (tenantId=t_123, mailboxId=m_45) */
const PLUS_TAG_PATTERN = /^(.+)\+(t_[a-zA-Z0-9_-]+)_(m_[a-zA-Z0-9_-]+)$/;

export function parseRoutingAddress(recipient: string): RoutingAddress | null {
  const normalized = recipient.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (at <= 0) return null;

  const localPart = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const match = localPart.match(PLUS_TAG_PATTERN);
  if (!match) return null;

  return {
    localPart: match[1]!,
    tenantId: match[2]!,
    mailboxId: match[3]!,
    domain,
    raw: normalized,
  };
}

export function buildRoutingAddress(
  localPart: string,
  tenantId: string,
  mailboxId: string,
  domain: string,
): string {
  return `${localPart}+${tenantId}_${mailboxId}@${domain}`;
}
