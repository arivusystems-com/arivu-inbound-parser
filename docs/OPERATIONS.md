# Operator guide — Arivu Inbound Parser

Internal console for monitoring ingest, debugging failures, and recovering stuck work.

## Admin UI pages

| Page | URL | Purpose |
|------|-----|---------|
| Dashboard | `/` | Message counts, DLQ depth, queue backlog, 24h ingest |
| Messages | `/messages` | Browse/filter inbound mail |
| Message detail | `/messages/:id` | Bodies, attachments, replay parse, redispatch CRM event |
| Failures | `/failures` | `failed` and `duplicate` messages |
| DLQ | `/dlq` | Jobs that exhausted retries — requeue to original queue |
| Queues | `/queues` | BullMQ depths per queue |
| Mailboxes | `/mailboxes` | Routing addresses for forwarding setup |
| Logs | `/logs` | Tail `logs/arivu.log` (JSON lines from all services) |

Start UI: `pnpm --filter @arivu/admin-ui dev`  
API base: `http://localhost:3000` (proxied as `/api` in dev)

## Processing statuses

| Status | Meaning |
|--------|---------|
| `received` | SMTP accepted |
| `raw_stored` | MIME in OCI |
| `queued` | Parse job enqueued |
| `parsing` | Parser running |
| `attachments_pending` | Waiting for attachment worker |
| `processed` | Ready; CRM event dispatched (or queued) |
| `failed` | Parse/attachment error — raw MIME kept |
| `duplicate` | Same RFC Message-ID already in mailbox — no CRM event |

## Common tasks

### Replay a failed parse

1. **Failures** or **Message detail** → **Replay** / **Replay parse**
2. Re-reads raw `.eml` from OCI and re-runs parser (+ attachments if any)
3. Clears `eventDispatchedAt` so CRM can receive a new event after success

### Redispatch CRM event only

Message detail → **Redispatch CRM event** (message must be `processed`).  
Use when parse succeeded but CRM webhook failed.

### Recover a DLQ job

1. **DLQ** page → find job (queue name, error, message link)
2. **Requeue** — job returns to original queue (`mime-parse`, `attachment-process`, or `event-dispatch`)
3. Watch **Queues** and worker logs

### Find logs for a message

**Logs** → filter by **Message ID** (`msg_...` or correlation id).  
Log file: `logs/arivu.log` at repo root (all `dev:core` services append JSON lines).

### Check pipeline health

```bash
pnpm infra:ps
pnpm storage:check
curl http://localhost:3000/admin/stats
curl http://localhost:3000/admin/metrics
```

## Retry policy

Configured in `.env`:

```env
QUEUE_MAX_ATTEMPTS=3
QUEUE_BACKOFF_MS=2000
```

Exponential backoff between attempts. After final failure, job moves to **dead-letter** queue.

## Idempotency

- **SMTP duplicate delivery:** Parser detects duplicate RFC `Message-ID` per mailbox → status `duplicate`, no CRM event.
- **CRM events:** `eventDispatchedAt` on message + `X-Arivu-Idempotency-Key` on webhook.

## Failure runbook (top cases)

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| SMTP 550 Unknown mailbox | Missing seed / wrong plus-address | `pnpm seed`, check **Mailboxes** |
| Stuck `queued` | Redis down or workers stopped | `pnpm infra:up`, `pnpm dev:core` |
| `failed` parse | Malformed MIME | **Replay** after fix; inspect raw MIME path in OCI |
| OCI errors | Credentials / bucket | `pnpm storage:check` |
| CRM event missing | Dispatcher down or webhook error | Check event-dispatcher logs; **Redispatch** |
| Job in DLQ | Repeated transient errors | **DLQ → Requeue** after fixing root cause |
| `duplicate` | Provider resent same Message-ID | Expected — no action unless wrong dedupe |

## Related docs

- [OCI storage](./OCI-STORAGE.md)
- [CRM events](./EVENTS.md)
- [Security (Phase 4)](./SECURITY.md)
- [README](../README.md)
