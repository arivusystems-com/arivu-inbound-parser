# CRM webhook integration guide

**Audience:** CRM/backend engineers implementing the inbound email webhook.  
**Parser version:** MVP (Phases 0–4)  
**Event type:** `email.received` (v1)

This document is the **contract** between **Arivu Inbound Parser** and your CRM. Follow it to avoid delivery failures, duplicate tickets, and retry storms.

---

## 0. Before the first email (provisioning)

When CRM creates a virtual mailbox, register it with the parser **before** the user enables Gmail/M365 forwarding:

```http
POST /integrations/v1/mailboxes
Authorization: Bearer <CRM_API_KEY>
```

See **[CRM provisioning API](./CRM-PROVISIONING.md)** for the full contract and examples.

---

## 1. Overview

```text
Inbound email → Parser (SMTP, parse, attachments, thread)
              → status = processed
              → event-dispatcher POSTs JSON to your CRM webhook
              → CRM creates/updates conversation using messageId
```

The webhook is a **notification**, not the full email payload. It carries stable IDs so the CRM can fetch or sync content later.

| Principle | Detail |
|-----------|--------|
| **At-least-once delivery** | Same event may arrive more than once (retries, redispatch). CRM **must** dedupe. |
| **Webhook = pointer** | Body has IDs + metadata only. Bodies/attachments live in parser storage/API. |
| **Success = HTTP 2xx** | Any non-2xx response causes parser retries, then DLQ. |
| **Tenant isolation** | Always scope CRM data by `tenantId`. |

---

## 2. When you receive an event

An `email.received` webhook is sent **only when**:

1. Message `processingStatus` is **`processed`**
2. MIME parsing succeeded (and attachments processed if any)
3. Message is **not** `duplicate` or `failed`
4. `eventDispatchedAt` was not already set (first successful dispatch)

**You will NOT receive a webhook when:**

| Situation | Parser status |
|-----------|----------------|
| SMTP rejected (unknown mailbox, rate limit) | Nothing stored |
| Parse failed | `failed` |
| Duplicate RFC Message-ID | `duplicate` |
| Auth rejected (`SECURITY_AUTH_MODE=enforce`) | `failed` |
| Still processing | `queued`, `parsing`, `attachments_pending` |

---

## 3. HTTP request contract

### 3.1 Method and URL

| Item | Value |
|------|--------|
| Method | `POST` |
| URL | Your endpoint, configured in parser as `CRM_WEBHOOK_URL` |
| Body | UTF-8 JSON |
| Timeout | Parser aborts after **30 seconds** |

Example parser `.env`:

```env
CRM_WEBHOOK_URL=https://crm.example.com/api/webhooks/arivu/inbound-email
CRM_WEBHOOK_SECRET=your-shared-hmac-secret-min-32-chars
```

### 3.2 Request headers

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | Always `application/json` |
| `X-Arivu-Idempotency-Key` | Yes | Same value as JSON `messageId` |
| `X-Arivu-Signature` | If secret configured | `sha256=<hex>` HMAC-SHA256 of **raw body bytes** |

### 3.3 JSON body schema

```json
{
  "event": "email.received",
  "tenantId": "t_123",
  "mailboxId": "m_45",
  "messageId": "msg_01KS9RS1478G7190G8D6NCN6ZT",
  "threadId": "thr_01KS9RS1P2FD9Q5ATE33RG498X",
  "receivedAt": "2026-05-23T06:36:18.831Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event` | string | Yes | Always `"email.received"` |
| `tenantId` | string | Yes | Tenant scope, e.g. `t_123` |
| `mailboxId` | string | Yes | Mailbox scope, e.g. `m_45` |
| `messageId` | string | Yes | **Parser internal ID** (`msg_` + ULID). **Idempotency key.** |
| `threadId` | string | No | Conversation ID when threading resolved |
| `receivedAt` | string | Yes | ISO-8601 UTC timestamp of SMTP ingest |

#### Naming trap: two different “message IDs”

| Name in webhook | Name in parser DB | Meaning |
|-----------------|-------------------|---------|
| `messageId` | `_id` | Parser internal id — **use for webhook dedupe** |
| *(not in webhook)* | `messageId` | RFC `Message-ID` email header (after parse) |

**CRM dedupe key:** `(tenantId, webhook.messageId)`.

---

## 4. HTTP response contract (CRM → Parser)

Respond within **30 seconds** (aim for **< 5 s**).

| Status | Parser behavior |
|--------|-----------------|
| **200–299** | Success. Sets `eventDispatchedAt`. No retry. |
| **400–499** | Failure. Retries, then DLQ. |
| **500–599** | Failure. Retries (default **3** attempts, exponential backoff from **2 s**). |
| Timeout / network | Same as 5xx |

Response body is **ignored** — only status code matters.

### Recommended handler flow

```text
1. Verify signature (if secret configured)
2. Parse JSON; validate required fields
3. If (tenantId, messageId) already processed → return 200
4. Persist idempotency record (transaction / unique index)
5. Enqueue CRM background job (recommended)
6. Return 200
```

Return **200 only after** the idempotency record is committed. Do not return 200 before durable storage.

---

## 5. Idempotency

### Parser guarantees

- Job id: `email-received-{messageId}`
- `eventDispatchedAt` prevents duplicate send after success
- **Redispatch** (admin) intentionally sends again for the same `messageId`

### CRM requirements

```sql
-- Example
CREATE UNIQUE INDEX inbound_events_tenant_message
  ON inbound_events (tenant_id, parser_message_id);
```

| Scenario | Same webhook payload? | CRM action |
|----------|----------------------|------------|
| Parser retry after 503 | Yes | Return 200, no duplicate ticket |
| Duplicate SMTP (same RFC Message-ID) | No webhook | N/A |
| Admin redispatch | Yes | Business rule: update or ignore |

---

## 6. Signature verification

When `CRM_WEBHOOK_SECRET` is set:

```http
X-Arivu-Signature: sha256=<hex>
```

HMAC-SHA256 of the **exact raw JSON body** (no pretty-print, no key reorder).

### Node.js (Express)

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';
import express from 'express';

function verifySignature(rawBody: string, secret: string, header: string | undefined): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const received = header.slice('sha256='.length);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

const app = express();

app.post(
  '/api/webhooks/arivu/inbound-email',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const raw = req.body.toString('utf8');
  const secret = process.env.ARIVU_WEBHOOK_SECRET!;

    if (secret && !verifySignature(raw, secret, req.headers['x-arivu-signature'] as string)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(raw) as EmailReceivedEvent;
    if (event.event !== 'email.received') {
      return res.status(400).json({ error: 'Unknown event type' });
    }

    // ... idempotency + enqueue ...

    return res.status(200).json({ ok: true });
  },
);
```

### Python (FastAPI)

```python
import hmac
import hashlib
import json
from fastapi import FastAPI, Request, HTTPException

app = FastAPI()

def verify_signature(raw_body: bytes, secret: str, header: str | None) -> bool:
    if not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header[7:])

@app.post("/api/webhooks/arivu/inbound-email")
async def inbound_email(request: Request):
    raw = await request.body()
    secret = os.environ["ARIVU_WEBHOOK_SECRET"]

    if secret and not verify_signature(raw, secret, request.headers.get("x-arivu-signature")):
        raise HTTPException(status_code=401, detail="Invalid signature")

    event = json.loads(raw)
    if event.get("event") != "email.received":
        raise HTTPException(status_code=400, detail="Unknown event type")

    # ... idempotency + enqueue ...

    return {"ok": True}
```

**Dev without secret:** If `CRM_WEBHOOK_SECRET` is unset on the parser, no signature header is sent. Use IP allowlist or mTLS in production.

---

## 7. Fetching full message content

The webhook does **not** include subject, body, from, or attachments.

### Option A — Parser admin API (available today, dev/integration)

After receiving the webhook, fetch details:

```http
GET http://<parser-api-host>:3000/integrations/v1/messages/{messageId}
Authorization: Bearer <CRM_API_KEY>
```

(`GET /admin/messages/{messageId}` is for the **admin UI** and requires an admin session token when `ADMIN_PASSWORD` is set — not `CRM_API_KEY`.)

Example response fields useful to CRM:

| Field | Use |
|-------|-----|
| `subject`, `from`, `to`, `cc` | Ticket title / participants |
| `textBody`, `htmlBody` | Message content |
| `attachments[]` | `filename`, `mimeType`, `size`, `storagePath`, `contentId` |
| `threadId` | Thread grouping (same as webhook) |
| `messageId` | RFC Message-ID header |
| `authResults` | SPF/DKIM/DMARC summary |
| `rawMimePath` | OCI path to raw `.eml` |

**Security note:** Admin API has **no auth in MVP**. For production CRM integration, either:

- Put parser API on private network + service token (you add middleware), or
- Build a dedicated `GET /integrations/messages/:id` with API key (future), or
- Replicate content into CRM at webhook time via internal fetch

Always pass `tenantId` from webhook and **verify** the returned message’s `tenantId` matches before use.

### Option B — CRM stores content on fetch

Recommended flow:

```text
Webhook received
  → enqueue job(parserMessageId, tenantId, mailboxId, threadId)
  → worker calls parser API GET /admin/messages/{messageId}
  → create CRM ticket + attachments metadata
```

### Attachments

Binary files are in **OCI Object Storage**, not MongoDB. Paths like:

```text
attachments/{tenantId}/{attachmentId}
```

Signed download URLs or a parser proxy endpoint are **not** in MVP — plan CRM access via shared storage credentials or a future parser API.

---

## 8. Mapping to CRM entities

| Webhook field | Suggested CRM mapping |
|---------------|----------------------|
| `tenantId` | Organization / workspace |
| `mailboxId` | Inbox / queue / team mailbox |
| `threadId` | Conversation / ticket thread |
| `messageId` | External ref `parser_message_id` (unique per tenant) |
| `receivedAt` | Message received timestamp |

Plus-address routing (how mail arrives):

```text
support+{tenantId}_{mailboxId}@reply.arivusystems.com
```

Example: `support+t_123_m_45@reply.arivusystems.com` → `tenantId=t_123`, `mailboxId=m_45`.

---

## 9. Threading and replies

Parser resolves `threadId` in this order:

1. `X-Arivu-Thread` / `X-Arivu-Message` headers (when CRM sends outbound mail through Arivu)
2. `In-Reply-To` / `References`
3. Normalized subject (fallback)

**CRM outbound tip:** When sending replies, set:

```http
X-Arivu-Tenant: t_123
X-Arivu-Mailbox: m_45
X-Arivu-Thread: thr_01J...
X-Arivu-Message: msg_01J...
```

Then inbound replies link to the same `threadId` without subject matching.

---

## 10. Retry and failure behavior

| Config (parser) | Default |
|-----------------|--------|
| `QUEUE_MAX_ATTEMPTS` | 3 |
| `QUEUE_BACKOFF_MS` | 2000 (exponential) |

After final failure → job in **dead-letter queue**. Operator can requeue from parser admin UI.

| CRM mistake | Effect |
|-------------|--------|
| Always return 500 | Event stuck in retry/DLQ; message stays `processed` but CRM never synced |
| Return 200 before save | Silent data loss on CRM crash |
| Slow handler (>30s) | Timeout → retries |
| Return 401 for valid sig | Permanent failure after retries |

---

## 11. Local testing

### Step 1 — See events without CRM

Leave `CRM_WEBHOOK_URL` unset. Run `pnpm dev:core`. Send test mail. In **event-dispatcher** logs:

```json
{"type":"event","event":"email.received","tenantId":"t_123","mailboxId":"m_45","messageId":"msg_...","threadId":"thr_...","receivedAt":"..."}
```

### Step 2 — CRM stub on localhost

```bash
# Terminal 1: minimal stub (Node 20+)
node --input-type=module -e "
import http from 'node:http';
import { createHmac } from 'node:crypto';
const SECRET = process.env.ARIVU_WEBHOOK_SECRET || 'dev-secret';
const seen = new Set();
http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404); return res.end();
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  const sig = req.headers['x-arivu-signature'];
  const expected = 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex');
  if (sig !== expected) { res.writeHead(401); return res.end('bad sig'); }
  const body = JSON.parse(raw);
  const key = body.tenantId + ':' + body.messageId;
  if (seen.has(key)) { console.log('DUPLICATE', key); }
  else { seen.add(key); console.log('OK', body); }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}).listen(4000, () => console.log('CRM stub :4000/webhook'));
"

# Terminal 2: parser .env
# CRM_WEBHOOK_URL=http://127.0.0.1:4000/webhook
# CRM_WEBHOOK_SECRET=dev-secret
pnpm dev:core
```

### Step 3 — End-to-end test mail

```bash
swaks --to support+t_123_m_45@reply.arivusystems.com \
  --from sender@example.com \
  --server localhost:2525 \
  --body "CRM webhook test"
```

### Step 4 — Verify idempotency

```bash
curl -X POST http://localhost:3000/admin/messages/msg_XXXX/redispatch-event
```

CRM stub should log `DUPLICATE` if dedupe works, or a second `OK` if you intentionally process redispatch.

---

## 12. Validation checklist (CRM PR)

- [ ] `POST` endpoint accepts `application/json`
- [ ] Returns **200** on success within 30s
- [ ] Unique index on `(tenant_id, parser_message_id)`
- [ ] Duplicate webhook returns **200** without duplicate side effects
- [ ] HMAC verified on raw body when secret configured
- [ ] Rejects unknown `event` types with **400**
- [ ] Invalid signature returns **401**
- [ ] Background worker fetches full message from parser API
- [ ] All CRM queries scoped by `tenantId`
- [ ] Logs include `messageId`, `tenantId`, `mailboxId` for support
- [ ] Tested with parser redispatch / simulated 503 retry

---

## 13. JSON Schema (draft)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["event", "tenantId", "mailboxId", "messageId", "receivedAt"],
  "additionalProperties": false,
  "properties": {
    "event": { "const": "email.received" },
    "tenantId": { "type": "string", "minLength": 1 },
    "mailboxId": { "type": "string", "minLength": 1 },
    "messageId": { "type": "string", "pattern": "^msg_" },
    "threadId": { "type": "string" },
    "receivedAt": { "type": "string", "format": "date-time" }
  }
}
```

---

## 14. Versioning

| Version | Events | Notes |
|---------|--------|-------|
| **v1 (current)** | `email.received` | IDs only |
| v2 (future) | TBD | Possible: inline snippet, attachment count, auth summary |

Unknown `event` values → return **400** so parser does not mark success incorrectly.

---

## 15. Related docs

- [EVENTS.md](./EVENTS.md) — parser-side event dispatch
- [OPERATIONS.md](./OPERATIONS.md) — redispatch, DLQ, admin UI
- [SECURITY.md](./SECURITY.md) — auth results on messages

---

## 16. Quick reference card

```text
POST {CRM_WEBHOOK_URL}
Content-Type: application/json
X-Arivu-Idempotency-Key: {messageId}
X-Arivu-Signature: sha256={hmac(raw_body)}   # if secret set

{
  "event": "email.received",
  "tenantId": "t_123",
  "mailboxId": "m_45",
  "messageId": "msg_01J...",
  "threadId": "thr_01J...",        // optional
  "receivedAt": "2026-05-23T06:36:18.831Z"
}

→ CRM responds 200 within 30s
→ CRM dedupes on (tenantId, messageId)
→ CRM fetches GET /admin/messages/{messageId} for content
```
