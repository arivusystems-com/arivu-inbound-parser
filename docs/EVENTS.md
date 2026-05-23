# Outbound events (CRM integration)

After a message reaches `processingStatus: processed`, the **event-dispatcher** worker publishes an `email.received` event to your CRM.

## Event: `email.received`

```json
{
  "event": "email.received",
  "tenantId": "t_123",
  "mailboxId": "m_45",
  "messageId": "msg_01JXXXXXXXX",
  "threadId": "thr_01JXXXXXXXX",
  "receivedAt": "2026-05-23T10:00:00.000Z"
}
```

| Field | Description |
|-------|-------------|
| `messageId` | Internal message id (`msg_*` / ULID) — use for idempotency |
| `tenantId` | Tenant scope |
| `mailboxId` | Mailbox that received the mail |
| `threadId` | Conversation id (when resolved) |
| `receivedAt` | ISO-8601 ingest time |

Fetch full message content via parser API — see [CRM webhook integration guide](./CRM-WEBHOOK-INTEGRATION.md).

## Delivery

| Mode | Config | Behavior |
|------|--------|----------|
| **Development** | `CRM_WEBHOOK_URL` unset | JSON line logged to `event-dispatcher` stdout |
| **Production** | `CRM_WEBHOOK_URL` set | HTTP `POST` with JSON body |

### Webhook headers

| Header | Description |
|--------|-------------|
| `Content-Type` | `application/json` |
| `X-Arivu-Idempotency-Key` | Same as `messageId` |
| `X-Arivu-Signature` | `sha256=<hex>` HMAC of body when `CRM_WEBHOOK_SECRET` is set |

Verify signature:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifySignature(body: string, secret: string, header: string | undefined): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const received = header.slice('sha256='.length);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
```

## Idempotency

- BullMQ job id: `email-received-{messageId}` (one pending dispatch job per message).
- MongoDB field `eventDispatchedAt` — dispatcher skips publish if already set.
- CRM should treat `X-Arivu-Idempotency-Key` / `messageId` as dedupe key.

## Configuration

```env
# Optional — omit for console logging in dev
CRM_WEBHOOK_URL=https://crm.example.com/webhooks/inbound-email
CRM_WEBHOOK_SECRET=your-shared-secret
```

## Pipeline

```text
parser-worker (no attachments) ──┐
                                 ├──► event-dispatch queue ──► event-dispatcher ──► CRM
attachment-worker (done) ────────┘
```

## Re-dispatch (admin)

```http
POST /admin/messages/:id/redispatch-event
```

Clears `eventDispatchedAt` and enqueues a new dispatch job (for recovery after CRM outage).
