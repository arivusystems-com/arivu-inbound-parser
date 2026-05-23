# Arivu Inbound Parser

Multi-tenant inbound email parser and routing engine for Arivu CRM. Handles SMTP ingestion, MIME parsing, threading, attachment extraction, tenant resolution, and operator admin UI.

## Prerequisites

- **Node.js 20+** (via nvm or system Node)
- **Docker Engine + Compose** (for MongoDB, Redis, MinIO, MailHog)
- **pnpm 9** — this repo uses pnpm workspaces. If `pnpm` is not found, use **one** of:

```bash
# Option A — recommended (built into Node via corepack)
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm --version

# Option B — global install
npm install -g pnpm@9.15.0

# Option C — no global install (prefix every command with npx)
npx pnpm@9.15.0 install
npx pnpm@9.15.0 build
```

Infrastructure commands work **without pnpm** — use Docker directly:

```bash
docker compose up -d      # same as pnpm infra:up
docker compose down       # same as pnpm infra:down
```

### Install Docker (Ubuntu / Debian)

If you see `docker: not found`:

```bash
# Official Docker convenience script (recommended)
curl -fsSL https://get.docker.com | sh

# Add your user to the docker group (log out & back in after this)
sudo usermod -aG docker $USER

# Verify
docker --version
docker compose version
```

Or via apt:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER
# log out and back in, then:
docker compose version
```

Then from the project root:

```bash
pnpm infra:up
```

### Without Docker

You can point `.env` at existing services instead:

| Variable | Example (local install) |
|----------|-------------------------|
| `MONGODB_URI` | `mongodb://localhost:27017/arivu-inbound` |
| `REDIS_URL` | `redis://localhost:6379` |
| `STORAGE_*` | OCI Object Storage (required) — see [OCI-STORAGE.md](./docs/OCI-STORAGE.md) |

Install locally (Ubuntu): `sudo apt install mongodb redis-server` and run [MinIO](https://min.io/docs/minio/linux/index.html) separately, or use cloud MongoDB Atlas + Upstash Redis + OCI bucket for dev.

## Quick start

### 1. Infrastructure

```bash
cp .env.example .env
pnpm infra:up
# or: docker compose up -d
```

Starts MongoDB, Redis, and MailHog. **Object storage uses OCI** — configure `STORAGE_*` in `.env` (see [OCI setup](./docs/OCI-STORAGE.md)).

### 2. OCI Object Storage

Copy `.env.example` to `.env` and set your OCI S3-compatible credentials:

```bash
cp .env.example .env
# Edit STORAGE_ENDPOINT, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY, STORAGE_BUCKET
```

Full steps: **[docs/OCI-STORAGE.md](./docs/OCI-STORAGE.md)**

### 3. Install & build

```bash
pnpm install
pnpm build
pnpm seed
```

### 4. Run services

```bash
pnpm dev:core
```

In another terminal:

```bash
pnpm --filter @arivu/admin-ui dev
# or: npx pnpm@9.15.0 --filter @arivu/admin-ui dev
```

| Service | URL / Port |
|---------|------------|
| Admin UI | http://localhost:5173 |
| API | http://localhost:3000 |
| SMTP ingest | `localhost:2525` |
| MailHog UI | http://localhost:8025 |

Object storage: **OCI bucket** (see [OCI-STORAGE.md](./docs/OCI-STORAGE.md))

### 5. Send a test email

Use any SMTP client (swaks, nodemailer, etc.) to deliver to the dev routing address:

```text
support+t_123_m_45@reply.arivusystems.com
```

Example with swaks:

```bash
swaks --to support+t_123_m_45@reply.arivusystems.com \
  --from sender@example.com \
  --server localhost:2525 \
  --body "Hello from test"
```

Then open the Admin UI → **Messages** → click a row for **detail + replay parse**.

## Monorepo layout

```text
apps/
  smtp-server/       SMTP ingest (thin: store raw + enqueue)
  parser-worker/     MIME parsing + threading (BullMQ)
  attachment-worker/ Attachment extraction → OCI
  api/               Admin + health API
  admin-ui/          Operator console (6 pages)

packages/
  types/             Shared TypeScript types
  config/            Zod env validation
  logger/            Pino logging
  database/          MongoDB client + indexes
  storage/           OCI Object Storage (S3-compatible API)
  queue/             BullMQ helpers
  routing/           Plus-address parser
  events/            CRM event schemas
```

## Docs

- [**Production deployment guide**](./docs/PRODUCTION-DEPLOYMENT.md) — infrastructure, env, go-live checklist
- [OCI Object Storage setup](./docs/OCI-STORAGE.md)
- [CRM events (`email.received`)](./docs/EVENTS.md)
- [**CRM provisioning API**](./docs/CRM-PROVISIONING.md) — register tenants/mailboxes from CRM (no manual seed)
- [**CRM webhook integration guide**](./docs/CRM-WEBHOOK-INTEGRATION.md) — contract for CRM developers
- [Operator guide (admin UI)](./docs/OPERATIONS.md)
- [Security (Phase 4)](./docs/SECURITY.md)
- [Detailed requirements](./Arivu%20Inbound%20Parser%20-%20Detailed%20Requir.md)
- [Implementation roadmap](./ROADMAP.md)

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all packages and apps |
| `pnpm dev:core` | API + SMTP + parser + attachment + event-dispatcher workers |
| `pnpm dev:stop` | Free ports 3000 and 2525 (kill stale dev processes) |
| `pnpm seed` | Seed dev tenant/mailbox |
| `pnpm test` | Run routing unit tests |
| `pnpm infra:up` | Start Docker dependencies (`docker compose up -d`) |
| `pnpm infra:ps` | Show Docker service status |
| `pnpm prod:up` | **Production:** build, start Mongo/Redis, all services + admin UI |
| `pnpm prod:down` | Stop production services (`pnpm prod:down -- --infra` also stops Docker) |
| `pnpm prod:status` | Production PIDs and API health |
| `pnpm prod:check` | Pre-flight: Node, ports, `storage:check` |
| `pnpm prod:seed` | Upsert tenant + mailbox in MongoDB (see `--help`) |

If `pnpm` is not installed, replace `pnpm` with `npx pnpm@9.15.0` in any command above.

## Troubleshooting

### `permission denied` connecting to `docker.sock`

Your user is not in the `docker` group yet:

```bash
sudo usermod -aG docker $USER
```

Then **log out and log back in** (or reboot). Verify:

```bash
docker ps
pnpm infra:up
```

**Quick workaround** (until you re-login):

```bash
sudo docker compose up -d
```

To run all compose commands with sudo until group membership applies:

```bash
sudo docker compose ps
sudo docker compose down
```

### `ECONNREFUSED 127.0.0.1:6379` (Redis)

Docker is not running or Redis container is down:

```bash
pnpm infra:up
pnpm infra:ps    # redis should be "Up"
```

### `EADDRINUSE` port 3000 or 2525

A previous `dev:core` is still running:

```bash
pnpm dev:stop
pnpm dev:core
```

Or manually:

```bash
ss -tlnp | grep -E '3000|2525'
fuser -k 3000/tcp 2525/tcp
```
