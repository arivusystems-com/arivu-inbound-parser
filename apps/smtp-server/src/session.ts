import type { SMTPServerSession } from 'smtp-server';
import type { RoutingAddress } from '@arivu/types';

export interface InboundSmtpSession extends SMTPServerSession {
  routing?: RoutingAddress;
  clientIp?: string;
  mailFrom?: string;
  heloHost?: string;
}

export function getSession(session: SMTPServerSession): InboundSmtpSession {
  return session as InboundSmtpSession;
}
