# CRM provisioning API

Register tenants and mailboxes in the **inbound parser** when your CRM creates a virtual mailbox — no manual `pnpm prod:seed`.

**Flow:**

```text
CRM creates virtual mailbox
  → POST /integrations/v1/mailboxes  (parser MongoDB)
  → CRM shows routingAddress to user
  → User sets Gmail/M365 forwarding to that address
  → Email arrives → parser accepts → webhook → CRM fetches message
```

---

## Authentication

Set in parser `.env`:

```env
CRM_API_KEY=your-long-random-secret-min-32-chars
```

Send on every request (either header):

```http
Authorization: Bearer <CRM_API_KEY>
```

or

```http
X-Arivu-Api-Key: <CRM_API_KEY>
```

| Environment | `CRM_API_KEY` unset |
|-------------|---------------------|
| **production** | Provisioning API returns **503** (disabled) |
| **development** | Allowed without key (local testing only) |

Use a **private network** or VPN in production; do not expose port 3000 publicly without TLS and IP restrictions.

---

## Register tenant + mailbox (main endpoint)

When CRM creates a virtual mailbox, call this **before** the user enables forwarding.

```http
POST http://<parser-api>:3000/integrations/v1/mailboxes
Authorization: Bearer <CRM_API_KEY>
Content-Type: application/json
```

### Request body

```json
{
  "tenantId": "t_xyz",
  "tenantName": "Xyz Corp",
  "mailboxId": "m_vm_a1b2c3",
  "mailboxName": "Support",
  "routingLocalPart": "support",
  "type": "shared"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `tenantId` | Yes | Must match `t_<id>` (e.g. `t_xyz`) — same ID CRM uses everywhere |
| `mailboxId` | Yes | Must match `m_<id>` — your virtual mailbox ID |
| `tenantName` | No | Display name (default: `tenantId`) |
| `mailboxName` | No | Default: `Inbox` |
| `routingLocalPart` | No | Default: `support` |
| `type` | No | `shared` or `private` (default: `shared`) |

### Response `200`

```json
{
  "ok": true,
  "tenantId": "t_xyz",
  "tenantName": "Xyz Corp",
  "mailboxId": "m_vm_a1b2c3",
  "mailboxName": "Support",
  "mailboxType": "shared",
  "routingAddress": "support+t_xyz_m_vm_a1b2c3@reply.arivusystems.com",
  "forwardingHint": "Configure Gmail/M365 forwarding to: support+t_xyz_m_vm_a1b2c3@reply.arivusystems.com"
}
```

Store `routingAddress` in CRM and show it in the UI for forwarding setup.

**Idempotent:** Safe to call again with the same IDs (upsert).

### Errors

| Status | Meaning |
|--------|---------|
| `400` | Invalid body / ID format |
| `401` | Missing or wrong API key |
| `409` | `mailboxId` owned by another tenant, or `routingAddress` collision |
| `503` | `CRM_API_KEY` not set in production |

---

## Register tenant only

Optional if you create the tenant before any mailbox:

```http
POST /integrations/v1/tenants
```

```json
{
  "tenantId": "t_xyz",
  "tenantName": "Xyz Corp"
}
```

---

## Get mailbox

```http
GET /integrations/v1/mailboxes/{mailboxId}?tenantId=t_xyz
```

---

## Delete mailbox

Only if **no messages** were ever ingested:

```http
DELETE /integrations/v1/mailboxes/{mailboxId}?tenantId=t_xyz
```

If messages exist, returns `409` — disable the mailbox in CRM instead.

---

## CRM implementation checklist

1. On **tenant create** in CRM → `POST /integrations/v1/tenants` (optional).
2. On **virtual mailbox create** → `POST /integrations/v1/mailboxes` with CRM-generated `tenantId` / `mailboxId`.
3. Save `routingAddress` on the CRM mailbox record.
4. Show `routingAddress` in UI for Gmail/M365 forwarding.
5. On **mailbox delete** in CRM → `DELETE /integrations/v1/mailboxes/...` if no mail yet.

### Node.js example

```typescript
async function provisionParserMailbox(input: {
  tenantId: string;
  tenantName: string;
  mailboxId: string;
  mailboxName: string;
}) {
  const res = await fetch(`${process.env.PARSER_API_URL}/integrations/v1/mailboxes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.CRM_API_KEY}`,
    },
    body: JSON.stringify({
      tenantId: input.tenantId,
      tenantName: input.tenantName,
      mailboxId: input.mailboxId,
      mailboxName: input.mailboxName,
      routingLocalPart: 'support',
      type: 'shared',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Parser provision failed: ${res.status} ${JSON.stringify(err)}`);
  }

  return res.json() as Promise<{ routingAddress: string }>;
}
```

Use the **same** `tenantId` and `mailboxId` in the plus-address and in webhook handling.

---

## Related docs

- [CRM webhook integration](./CRM-WEBHOOK-INTEGRATION.md) — `email.received` after mail is processed
- [Production deployment](./PRODUCTION-DEPLOYMENT.md)
