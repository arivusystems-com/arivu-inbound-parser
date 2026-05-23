# Production deployment guide

**Arivu Inbound Parser** — requirements, architecture, configuration, and go-live checklist for production.

## Quick start (single host)

One command brings up **MongoDB + Redis** (Docker), builds the monorepo, verifies OCI storage, and starts all five Node services plus the admin UI:

```bash
cp .env.example .env
# Edit .env: NODE_ENV=production, OCI keys, MONGODB_URI, REDIS_URL, CRM_WEBHOOK_URL, SMTP_PORT, etc.

pnpm prod:check    # optional pre-flight (Node, ports, storage:check)
pnpm prod:up       # build + infra + services + admin UI
pnpm prod:status   # PIDs, docker, API health
# Tenants/mailboxes: CRM calls POST /integrations/v1/mailboxes (see docs/CRM-PROVISIONING.md)
# Optional bootstrap only: pnpm prod:seed -- --tenant-id t_acme --mailbox-id m_support
pnpm prod:down     # stop apps
pnpm prod:down -- --infra   # stop apps + MongoDB/Redis containers
```

| Script | Purpose |
|--------|---------|
| `scripts/prod-up.sh` | Full production stack on this machine |
| `scripts/prod-down.sh` | Stop background services (`--infra` for Docker) |
| `scripts/prod-status.sh` | Running PIDs and health |
| `scripts/prod-check.sh` | Validate env and OCI without starting apps |
| `scripts/prod-seed.ts` | Upsert tenant + mailbox (`pnpm prod:seed`) |
| `docker-compose.prod.yml` | MongoDB 7 + Redis 7 (persistent volumes) |

**Flags for `prod-up`:** `--skip-infra` (managed Atlas/Redis), `--skip-ui`, `--skip-build`, `--skip-storage-check`.

Logs: `logs/*.log`. PIDs: `.run/prod/*.pid`. For multi-node or Kubernetes, use §5 systemd/K8s instead of these scripts.

---

Use this document with:

- [OCI Object Storage setup](./OCI-STORAGE.md)
- [CRM webhook integration](./CRM-WEBHOOK-INTEGRATION.md)
- [Security (Phase 4)](./SECURITY.md)
- [Operator guide](./OPERATIONS.md)

---

## 1. Production architecture

```text
                    Internet / mail providers
                              │
                    MX → load balancer (TCP 25/587)
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
        smtp-server (×N)                 (optional second node)
              │
              ├──► OCI Object Storage (raw MIME + attachments)
              ├──► MongoDB (metadata)
              └──► Redis (BullMQ queues)
                        │
        ┌───────────────┼───────────────┬──────────────────┐
        ▼               ▼               ▼                  ▼
  parser-worker    attachment-worker  event-dispatcher      api
     (×N)              (×N)              (×N)          (admin UI)
                                                      │
                                                      ▼
                                              CRM webhook (HTTPS)
```

### Runtime services (required)

| Service | Package | Role | Horizontally scalable |
|---------|---------|------|------------------------|
| **smtp-server** | `@arivu/smtp-server` | Accept SMTP, store raw MIME, enqueue parse | Yes (behind LB) |
| **parser-worker** | `@arivu/parser-worker` | MIME parse, thread, auth checks | Yes |
| **attachment-worker** | `@arivu/attachment-worker` | Extract attachments → OCI | Yes |
| **event-dispatcher** | `@arivu/event-dispatcher` | POST `email.received` to CRM | Yes |
| **api** | `@arivu/api` | Health, admin API, metrics | Yes (stateless) |

### Optional

| Component | Role |
|-----------|------|
| **admin-ui** | Operator console (static build + nginx) |
| **MailHog** | Dev only — **do not deploy to production** |

---

## 2. Infrastructure requirements

### 2.1 Managed services (recommended)

| Component | Requirement | Production notes |
|-----------|-------------|------------------|
| **MongoDB** | 7.x compatible | Replica set recommended. Atlas or self-hosted with backups. |
| **Redis** | 7.x compatible | BullMQ requires persistent Redis for queues. Enable AOF or RDB. |
| **OCI Object Storage** | S3-compatible bucket | Same region as compute when possible. IAM scoped to bucket. |
| **Compute** | Node.js **20+** | 2+ vCPU, 4 GB RAM minimum per worker host (scale with volume). |
| **TLS certificates** | SMTP + HTTPS | Let's Encrypt or cloud LB termination. |
| **DNS** | MX + A/AAAA | See §6 Mail DNS. |

### 2.2 Sizing (starting point)

| Volume | SMTP | parser-worker | attachment-worker | event-dispatcher | Redis | MongoDB |
|--------|------|---------------|-------------------|------------------|-------|---------|
| Low (<1k/day) | 1 | 1 | 1 | 1 | 1 GB | Shared M10 |
| Medium (10k/day) | 2 | 2–3 | 2 | 1–2 | 2 GB | Replica set |
| High (100k+/day) | 3+ | 5+ | 5+ | 2+ | Cluster | Dedicated cluster |

Workers are **stateless** — scale by increasing replica count.

### 2.3 Network ports

| Port | Service | Exposure |
|------|---------|----------|
| **25** or **587** | SMTP ingest | Public (via LB) |
| **2525** | SMTP (dev default) | Internal only in prod |
| **3000** | Admin API | Internal / VPN / reverse proxy only |
| **443** | Admin UI + API (HTTPS) | Operators only |
| **27017** | MongoDB | Private network only |
| **6379** | Redis | Private network only |

**Never** expose MongoDB, Redis, or admin API directly to the public internet without authentication and IP restrictions.

---

## 3. Environment variables (complete reference)

Copy `.env.example` to `.env` on each host (or inject via secrets manager). All services read from **repo root** `.env` when started with `--env-file=../../.env` or equivalent.

### 3.1 Core

| Variable | Required | Production example |
|----------|----------|-------------------|
| `NODE_ENV` | Yes | `production` |
| `LOG_LEVEL` | Yes | `info` (use `warn` if noisy) |
| `MONGODB_URI` | Yes | `mongodb+srv://user:pass@cluster.example/arivu-inbound?retryWrites=true` |
| `REDIS_URL` | Yes | `rediss://default:pass@redis.example:6379` |

### 3.2 OCI Object Storage

| Variable | Required | Notes |
|----------|----------|-------|
| `STORAGE_ENDPOINT` | Yes | `https://<namespace>.compat.objectstorage.<region>.oraclecloud.com` |
| `STORAGE_REGION` | Yes | Must match bucket region |
| `STORAGE_ACCESS_KEY` | Yes | Customer secret key — quote if special chars |
| `STORAGE_SECRET_KEY` | Yes | ~44 char base64 — quote in `.env` |
| `STORAGE_BUCKET` | Yes | e.g. `arivu-inbound-prod` |
| `STORAGE_FORCE_PATH_STYLE` | Yes | `true` for OCI |

Verify before go-live:

```bash
pnpm storage:check
```

See [OCI-STORAGE.md](./OCI-STORAGE.md).

### 3.3 SMTP

| Variable | Required | Production |
|----------|----------|------------|
| `SMTP_HOST` | Yes | `0.0.0.0` |
| `SMTP_PORT` | Yes | `25` or `587` (not 2525) |
| `SMTP_DOMAIN` | Yes | `reply.arivusystems.com` (your inbound domain) |
| `SMTP_TLS_ENABLED` | Recommended | `true` |
| `SMTP_TLS_KEY_PATH` | If TLS | Path to PEM private key |
| `SMTP_TLS_CERT_PATH` | If TLS | Path to PEM certificate |

### 3.4 Admin API

| Variable | Required | Production |
|----------|----------|------------|
| `API_HOST` | Yes | `0.0.0.0` |
| `API_PORT` | Yes | `3000` |

### 3.5 CRM webhook

| Variable | Required | Production |
|----------|----------|------------|
| `CRM_WEBHOOK_URL` | **Yes** | `https://crm.example.com/api/webhooks/arivu/inbound-email` |
| `CRM_WEBHOOK_SECRET` | **Strongly recommended** | Shared HMAC secret (32+ random bytes) |
| `CRM_API_KEY` | **Yes** | API key for CRM → `POST /integrations/v1/mailboxes` |

See [CRM-WEBHOOK-INTEGRATION.md](./CRM-WEBHOOK-INTEGRATION.md) and [CRM-PROVISIONING.md](./CRM-PROVISIONING.md).

### 3.6 Queues & reliability

| Variable | Default | Production |
|----------|---------|------------|
| `QUEUE_MAX_ATTEMPTS` | `3` | Keep or increase to `5` for flaky CRM |
| `QUEUE_BACKOFF_MS` | `2000` | Exponential backoff base |

### 3.7 Security (Phase 4)

| Variable | Dev | Production rollout |
|----------|-----|-------------------|
| `SECURITY_AUTH_MODE` | `off` | Start `monitor` → then `enforce` |
| `SECURITY_RATE_LIMIT_IP_PER_MIN` | `120` | Tune per expected provider IPs |
| `SECURITY_RATE_LIMIT_TENANT_PER_MIN` | `300` | Tune per tenant SLA |
| `SECURITY_IP_ALLOWLIST` | empty | Optional: Gmail/M365 forwarder egress IPs |
| `SECURITY_IP_BLOCKLIST` | empty | Known bad actors |
| `SECURITY_GREYLIST_ENABLED` | `false` | Enable after testing |
| `SECURITY_GREYLIST_TTL_SEC` | `300` | Greylist window |

See [SECURITY.md](./SECURITY.md).

### 3.8 Limits

| Variable | Default | Notes |
|----------|---------|-------|
| `MAX_MESSAGE_BYTES` | `52428800` (50 MB) | SMTP `SIZE` limit |
| `MAX_ATTACHMENT_BYTES` | `26214400` (25 MB) | Per attachment |
| `STREAM_CHUNK_BYTES` | `65536` | Internal streaming |

### 3.9 Logging

| Variable | Production |
|----------|------------|
| `LOG_FILE` | Set path on shared volume for admin Logs page, or `false` and use log shipper |
| | Default: `logs/arivu.log` at repo root |

---

## 4. Build and release

### 4.1 Build from source

On a build machine or CI:

```bash
git clone <repo> && cd arivu-inbound-parser
corepack enable && corepack prepare pnpm@9.15.0 --activate

pnpm install --frozen-lockfile
pnpm build
```

This compiles all `packages/*` and `apps/*` to `dist/`.

### 4.2 Production start commands

Run **each service as its own process** (systemd, Kubernetes Deployment, or process manager):

```bash
# From repo root, after build:
node apps/smtp-server/dist/index.js
node apps/parser-worker/dist/index.js
node apps/attachment-worker/dist/index.js
node apps/event-dispatcher/dist/index.js
node apps/api/dist/index.js
```

Or per-app:

```bash
pnpm --filter @arivu/smtp-server start
pnpm --filter @arivu/parser-worker start
pnpm --filter @arivu/attachment-worker start
pnpm --filter @arivu/event-dispatcher start
pnpm --filter @arivu/api start
```

**Environment:** inject `.env` via systemd `EnvironmentFile=`, Kubernetes Secret, or Docker env.

**Working directory:** repo root (so `@arivu/config` finds `.env` and `pnpm-workspace.yaml`).

### 4.3 Admin UI (static)

```bash
pnpm --filter @arivu/admin-ui build
# Output: apps/admin-ui/dist/
```

Serve `apps/admin-ui/dist/` with nginx/Caddy. Proxy `/api` → `http://127.0.0.1:3000` (see §5.3).

Optional build-time API URL:

```bash
VITE_API_URL=https://parser-admin.example.com/api pnpm --filter @arivu/admin-ui build
```

### 4.4 CI gate

GitHub Actions runs on push/PR: `pnpm build`, `lint`, `format:check`. Do not deploy commits that fail CI.

---

## 5. Deployment patterns

### 5.1 Single VM (minimum production)

One Ubuntu/Debian VM running all five services via **systemd**.

```text
/opt/arivu-inbound-parser/     # git clone or release tarball
├── .env                       # secrets (chmod 600)
├── apps/*/dist/
└── packages/*/dist/
```

**systemd example** (`/etc/systemd/system/arivu-smtp.service`):

```ini
[Unit]
Description=Arivu SMTP ingest
After=network.target

[Service]
Type=simple
User=arivu
WorkingDirectory=/opt/arivu-inbound-parser
EnvironmentFile=/opt/arivu-inbound-parser/.env
ExecStart=/usr/bin/node apps/smtp-server/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Duplicate for `arivu-parser-worker`, `arivu-attachment-worker`, `arivu-event-dispatcher`, `arivu-api`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now arivu-smtp arivu-parser-worker arivu-attachment-worker arivu-event-dispatcher arivu-api
```

### 5.2 Kubernetes (recommended at scale)

| Deployment | Replicas | Notes |
|------------|----------|-------|
| `smtp-server` | 2+ | LoadBalancer Service ports 25/587 |
| `parser-worker` | 2+ | HPA on CPU or queue depth |
| `attachment-worker` | 2+ | HPA |
| `event-dispatcher` | 1–2 | CRM rate limits may cap concurrency |
| `api` | 2 | ClusterIP + Ingress |

- Mount `.env` as Secret or use individual env vars from External Secrets Operator.
- Use managed MongoDB Atlas + Redis Cloud/ElastiCache — not in-cluster for production unless you operate them.
- Liveness: `GET /health` on API; SMTP has no HTTP health — use TCP check on `SMTP_PORT`.

### 5.3 Reverse proxy (admin API + UI)

**nginx** example — operators only:

```nginx
server {
    listen 443 ssl http2;
    server_name parser-admin.example.com;

    ssl_certificate     /etc/ssl/certs/parser-admin.pem;
    ssl_certificate_key /etc/ssl/private/parser-admin.key;

    # Basic auth or SSO in front — MVP API has no built-in auth
    auth_basic "Arivu Parser Admin";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location /api/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        root /opt/arivu-inbound-parser/apps/admin-ui/dist;
        try_files $uri $uri/ /index.html;
    }
}
```

Restrict by VPN or office IP in production.

---

## 6. Mail DNS and forwarding

### 6.1 Inbound domain

Use a dedicated subdomain, e.g. `reply.arivusystems.com`.

| Record | Example |
|--------|---------|
| **MX** | `10 mx1.reply.arivusystems.com` |
| **A** | `mx1.reply.arivusystems.com` → LB IP |

### 6.2 Plus-address routing

Customers forward mail to:

```text
support+{tenantId}_{mailboxId}@reply.arivusystems.com
```

Example: `support+t_123_m_45@reply.arivusystems.com`

### 6.3 Provider forwarding

Gmail / M365 / etc. forward to the plus-address above. Ensure:

- Forwarding preserves **full MIME** (headers for threading)
- Provider egress IPs are not blocklisted (allowlist if using `SECURITY_IP_ALLOWLIST`)

---

## 7. MongoDB production

### 7.1 Indexes

Created automatically on startup by `@arivu/database`:

- `tenantId`, `mailboxId`, `messageId`, `threadId`, `receivedAt`
- Unique partial index on `(mailboxId, messageId)` for RFC Message-ID dedupe
- Unique `routingAddress` on mailboxes

### 7.2 Tenants and mailboxes

**Do not use `pnpm seed` in production** (creates dev tenant `t_123`).

Insert tenants/mailboxes via your provisioning API or MongoDB:

```javascript
// tenants
{ _id: "t_acme", name: "Acme Inc" }

// mailboxes
{
  _id: "m_support",
  tenantId: "t_acme",
  type: "shared",
  name: "Support",
  routingAddress: "support+t_acme_m_support@reply.arivusystems.com"
}
```

### 7.3 Backup

- MongoDB Atlas: enable continuous backup
- Self-hosted: daily snapshots + oplog retention
- **Raw MIME in OCI is the source of truth** — MongoDB can be rebuilt from OCI for disaster recovery (with operational effort)

---

## 8. Redis production

- Enable persistence (AOF recommended for queue durability)
- Set `maxmemory-policy` appropriately; BullMQ keys must not be evicted unexpectedly
- Use TLS (`rediss://`) when connecting across networks
- Same VPC/region as workers

Queues in use:

```text
mime-parse
attachment-process
event-dispatch
dead-letter
```

(smtp-ingest is defined but not used — SMTP enqueues directly to `mime-parse`.)

---

## 9. OCI production checklist

- [ ] Bucket in correct region
- [ ] IAM: `OBJECT_CREATE`, `OBJECT_READ`, `OBJECT_INSPECT` on bucket only
- [ ] Customer secret keys stored in secrets manager, quoted in env
- [ ] `pnpm storage:check` passes from production host
- [ ] Lifecycle policy for old objects (optional, per compliance)
- [ ] No public bucket access

---

## 10. CRM integration checklist

- [ ] CRM webhook endpoint live (HTTPS, valid cert)
- [ ] `CRM_API_KEY` set; CRM calls provisioning API on mailbox create
- [ ] `CRM_WEBHOOK_URL` and `CRM_WEBHOOK_SECRET` set in parser `.env`
- [ ] CRM implements idempotency on `(tenantId, messageId)`
- [ ] CRM returns **HTTP 200 within 30s**
- [ ] CRM fetches message detail via parser API (private network)
- [ ] End-to-end test: ingest → webhook → CRM ticket created

Full contract: [CRM-WEBHOOK-INTEGRATION.md](./CRM-WEBHOOK-INTEGRATION.md).

---

## 11. Security hardening checklist

- [ ] `NODE_ENV=production`
- [ ] Secrets not in git (`.env` in `.gitignore`)
- [ ] MongoDB/Redis not public
- [ ] Admin API behind VPN / basic auth / SSO
- [ ] `SECURITY_AUTH_MODE=monitor` then `enforce`
- [ ] Rate limits tuned
- [ ] SMTP TLS enabled (or TLS at load balancer)
- [ ] OCI keys rotated; least-privilege IAM
- [ ] CRM webhook HMAC verified
- [ ] Firewall: only 25/587 public on SMTP LB

---

## 12. Monitoring and alerts

### 12.1 Health endpoints

```bash
curl -sf http://127.0.0.1:3000/health
# {"status":"ok","service":"api"}
```

### 12.2 Metrics (admin API)

```bash
curl http://127.0.0.1:3000/admin/metrics
curl http://127.0.0.1:3000/admin/stats
```

Monitor:

| Signal | Alert if |
|--------|----------|
| `messagesFailed` | Sustained increase |
| `dlqCount` / DLQ jobs | > 0 for > 15 min |
| Queue `waiting` depth | Growing without draining |
| `event-dispatch` failures | CRM outage |
| SMTP connection errors | LB or auth issues |
| OCI upload errors | Credential or quota |

### 12.3 Logs

- JSON logs to stdout (production `LOG_LEVEL=info`)
- Optional shared `LOG_FILE` for admin UI Logs page
- Ship to Loki/CloudWatch/Datadog in production

Correlate with `messageId`, `tenantId`, `correlationId` in log fields.

---

## 13. Pre-go-live verification

Run on staging that mirrors production:

```bash
# 1. Infrastructure
pnpm storage:check

# 2. Start all services (or systemd)
# 3. API health
curl -sf http://localhost:3000/health

# 4. Seed a real tenant/mailbox (not dev seed) in MongoDB

# 5. Send test email
swaks --to support+{tenant}_{mailbox}@reply.yourdomain.com \
  --from sender@example.com \
  --server localhost:2525 \
  --body "Production smoke test" \
  --attach /etc/hosts

# 6. Confirm in admin UI: Messages → processed, CRM event dispatched

# 7. Confirm CRM received webhook and fetched message detail

# 8. Test failure recovery: CRM returns 503 once → parser retries → eventual 200

# 9. Test duplicate: resend same Message-ID → status duplicate, no second CRM event
```

---

## 14. Post-deploy operations

| Task | Command / location |
|------|-------------------|
| View queue depth | Admin UI → Queues, or `GET /admin/queues` |
| Replay failed parse | Admin UI → Failures → Retry |
| Requeue DLQ job | Admin UI → DLQ |
| Redispatch CRM event | Message detail → Redispatch CRM event |
| Add mailbox | Insert into MongoDB `mailboxes` |
| Rotate OCI keys | New customer secret key → update `.env` → rolling restart |
| Scale workers | Increase systemd instances or K8s replicas |

Runbook: [OPERATIONS.md](./OPERATIONS.md).

---

## 15. Secrets management

**Do not commit `.env` to git.**

| Secret | Where to store |
|--------|----------------|
| `MONGODB_URI` | Vault / K8s Secret / cloud param store |
| `REDIS_URL` | Same |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | Same |
| `CRM_WEBHOOK_SECRET` | Same (shared with CRM team) |
| `SMTP_TLS_KEY_PATH` | Filesystem with restrictive permissions |

Rotate credentials on a schedule and after any exposure.

---

## 16. Production `.env` template

```env
NODE_ENV=production
LOG_LEVEL=info

MONGODB_URI=mongodb+srv://...
REDIS_URL=rediss://...

STORAGE_ENDPOINT=https://YOUR_NAMESPACE.compat.objectstorage.ap-hyderabad-1.oraclecloud.com
STORAGE_REGION=ap-hyderabad-1
STORAGE_ACCESS_KEY="..."
STORAGE_SECRET_KEY="..."
STORAGE_BUCKET=arivu-inbound-prod
STORAGE_FORCE_PATH_STYLE=true

SMTP_HOST=0.0.0.0
SMTP_PORT=25
SMTP_DOMAIN=reply.arivusystems.com
SMTP_TLS_ENABLED=true
SMTP_TLS_KEY_PATH=/etc/arivu/certs/smtp.key
SMTP_TLS_CERT_PATH=/etc/arivu/certs/smtp.crt

API_HOST=0.0.0.0
API_PORT=3000

CRM_WEBHOOK_URL=https://crm.example.com/api/webhooks/arivu/inbound-email
CRM_WEBHOOK_SECRET=generate-with-openssl-rand-hex-32
CRM_API_KEY=generate-with-openssl-rand-hex-32

QUEUE_MAX_ATTEMPTS=3
QUEUE_BACKOFF_MS=2000

SECURITY_AUTH_MODE=monitor
SECURITY_RATE_LIMIT_IP_PER_MIN=120
SECURITY_RATE_LIMIT_TENANT_PER_MIN=300

MAX_ATTACHMENT_BYTES=26214400
MAX_MESSAGE_BYTES=52428800
```

After mail flows cleanly in `monitor`, set `SECURITY_AUTH_MODE=enforce`.

---

## 17. Rollout order

1. Provision MongoDB, Redis, OCI bucket
2. Deploy workers + API (no public SMTP yet)
3. Run `storage:check`, `/health`, seed production tenants
4. Configure CRM webhook (staging URL first)
5. Point staging MX / test forwarder
6. End-to-end test with real provider mail
7. Enable production MX
8. Enable `SECURITY_AUTH_MODE=monitor` → observe → `enforce`
9. Enable monitoring alerts
10. Document on-call runbook

---

## 18. Related documents

| Doc | Purpose |
|-----|---------|
| [OCI-STORAGE.md](./OCI-STORAGE.md) | Bucket and credentials |
| [CRM-WEBHOOK-INTEGRATION.md](./CRM-WEBHOOK-INTEGRATION.md) | CRM developer contract |
| [SECURITY.md](./SECURITY.md) | Auth modes, rate limits |
| [OPERATIONS.md](./OPERATIONS.md) | Day-2 operator tasks |
| [EVENTS.md](./EVENTS.md) | Event dispatch overview |

---

## 19. Quick checklist (printable)

```
Infrastructure
  [ ] MongoDB replica set + backup
  [ ] Redis with persistence + TLS
  [ ] OCI bucket + IAM + storage:check OK
  [ ] Compute / systemd or K8s ready

Configuration
  [ ] NODE_ENV=production
  [ ] All STORAGE_* and CRM_* set
  [ ] SMTP_PORT=25 or 587, TLS configured
  [ ] Secrets not in git

Services
  [ ] smtp-server running
  [ ] parser-worker running
  [ ] attachment-worker running
  [ ] event-dispatcher running
  [ ] api running
  [ ] admin-ui served (optional, restricted)

Mail
  [ ] MX records live
  [ ] Tenants/mailboxes in MongoDB
  [ ] Provider forwarding tested

CRM
  [ ] Webhook returns 200
  [ ] Idempotency implemented
  [ ] Message fetch from parser API works

Security
  [ ] Admin API not public
  [ ] SECURITY_AUTH_MODE configured
  [ ] Rate limits set

Operations
  [ ] Monitoring on queues + DLQ + failures
  [ ] Log aggregation
  [ ] On-call runbook shared
```
