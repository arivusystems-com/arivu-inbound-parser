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

export class ConsoleEventPublisher implements EventPublisher {
  async publish(event: EmailReceivedEvent): Promise<void> {
    process.stdout.write(`${JSON.stringify({ type: 'event', ...event })}\n`);
  }
}
