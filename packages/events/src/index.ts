import { createHmac } from 'node:crypto';
import { z } from 'zod';

export const emailReceivedEventSchema = z.object({
  event: z.literal('email.received'),
  tenantId: z.string(),
  mailboxId: z.string(),
  messageId: z.string(),
  threadId: z.string().optional(),
  receivedAt: z.string().datetime(),
});

export type EmailReceivedEvent = z.infer<typeof emailReceivedEventSchema>;

export interface EventPublisher {
  publish(event: EmailReceivedEvent): Promise<void>;
}

export interface EmailReceivedMessageFields {
  _id: string;
  tenantId: string;
  mailboxId: string;
  threadId?: string;
  receivedAt: string;
}

export function buildEmailReceivedEvent(message: EmailReceivedMessageFields): EmailReceivedEvent {
  return {
    event: 'email.received',
    tenantId: message.tenantId,
    mailboxId: message.mailboxId,
    messageId: message._id,
    threadId: message.threadId,
    receivedAt: message.receivedAt,
  };
}

export class ConsoleEventPublisher implements EventPublisher {
  async publish(event: EmailReceivedEvent): Promise<void> {
    process.stdout.write(`${JSON.stringify({ type: 'event', ...event })}\n`);
  }
}

export class WebhookEventPublisher implements EventPublisher {
  constructor(
    private readonly url: string,
    private readonly secret?: string,
  ) {}

  async publish(event: EmailReceivedEvent): Promise<void> {
    const body = JSON.stringify(event);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Arivu-Idempotency-Key': event.messageId,
    };

    if (this.secret) {
      const sig = createHmac('sha256', this.secret).update(body).digest('hex');
      headers['X-Arivu-Signature'] = `sha256=${sig}`;
    }

    const res = await fetch(this.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`CRM webhook failed (${res.status}): ${text.slice(0, 500)}`);
    }
  }
}

export interface EventPublisherConfig {
  CRM_WEBHOOK_URL?: string;
  CRM_WEBHOOK_SECRET?: string;
}

export function createEventPublisher(config: EventPublisherConfig): EventPublisher {
  if (config.CRM_WEBHOOK_URL) {
    return new WebhookEventPublisher(config.CRM_WEBHOOK_URL, config.CRM_WEBHOOK_SECRET);
  }
  return new ConsoleEventPublisher();
}
