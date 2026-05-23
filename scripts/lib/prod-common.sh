#!/usr/bin/env bash
# Shared helpers for production scripts. Source from scripts/*.sh — do not execute directly.

set -euo pipefail

if [[ -z "${PROD_ROOT:-}" ]]; then
  PROD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi

PROD_PID_DIR="${PROD_PID_DIR:-$PROD_ROOT/.run/prod}"
PROD_LOG_DIR="${PROD_LOG_DIR:-$PROD_ROOT/logs}"
PROD_COMPOSE_FILE="${PROD_COMPOSE_FILE:-$PROD_ROOT/docker-compose.prod.yml}"

# Service name → node entry (run from PROD_ROOT; avoids pnpm wrapper PID issues)
PROD_SERVICES=(
  smtp-server
  parser-worker
  attachment-worker
  event-dispatcher
  api
)

service_entry() {
  echo "$PROD_ROOT/apps/$1/dist/index.js"
}

log() {
  printf '[prod] %s\n' "$*"
}

warn() {
  printf '[prod] WARNING: %s\n' "$*" >&2
}

die() {
  printf '[prod] ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  local cmd=$1
  command -v "$cmd" >/dev/null 2>&1 || die "Missing required command: $cmd"
}

require_node() {
  require_cmd node
  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  if [[ "$major" -lt 20 ]]; then
    die "Node.js 20+ required (found $(node -v))"
  fi
}

require_env_file() {
  if [[ ! -f "$PROD_ROOT/.env" ]]; then
    die "No .env at repo root. Copy .env.example to .env and fill in production values."
  fi
}

# Read a single key from .env without sourcing (safe for # and quotes in values).
env_val() {
  local key=$1
  local default=$2
  local line val
  if [[ ! -f "$PROD_ROOT/.env" ]]; then
    echo "$default"
    return
  fi
  line="$(grep -E "^${key}=" "$PROD_ROOT/.env" 2>/dev/null | tail -1 || true)"
  if [[ -z "$line" ]]; then
    echo "$default"
    return
  fi
  val="${line#*=}"
  val="${val#"${val%%[![:space:]]*}"}"
  val="${val%"${val##*[![:space:]]}"}"
  if [[ "$val" == \"*\" && "$val" == *\" ]]; then
    val="${val:1:${#val}-2}"
  elif [[ "$val" == \'*\' && "$val" == *\' ]]; then
    val="${val:1:${#val}-2}"
  fi
  echo "$val"
}

load_env_defaults() {
  API_PORT="$(env_val API_PORT 3000)"
  SMTP_PORT="$(env_val SMTP_PORT 25)"
  ADMIN_UI_PORT="$(env_val ADMIN_UI_PORT 5173)"
  NODE_ENV="$(env_val NODE_ENV "")"
}

ensure_dirs() {
  mkdir -p "$PROD_PID_DIR" "$PROD_LOG_DIR"
}

is_running_pid() {
  local pid=$1
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

read_pid() {
  local name=$1
  local file="$PROD_PID_DIR/$name.pid"
  if [[ -f "$file" ]]; then
    cat "$file"
  fi
}

wait_for_tcp() {
  local host=$1 port=$2
  local label=${3:-"$host:$port"}
  local timeout=${4:-90}
  local i=0
  log "Waiting for $label (up to ${timeout}s)..."
  while [[ $i -lt $timeout ]]; do
    if (echo >/dev/tcp/"$host"/"$port") 2>/dev/null; then
      log "$label is up"
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  die "Timed out waiting for $label"
}

is_service_running() {
  local name=$1
  local pid
  pid="$(read_pid "$name" || true)"
  is_running_pid "$pid"
}

show_log_tail() {
  local logfile=$1
  local lines=${2:-40}
  if [[ -f "$logfile" ]]; then
    printf '[prod] --- last %s lines of %s ---\n' "$lines" "$logfile"
    tail -n "$lines" "$logfile" || true
    printf '[prod] --- end ---\n'
  else
    warn "Log file not found: $logfile"
  fi
}

diagnose_api_failure() {
  local port=${1:-3000}
  local logfile="$PROD_LOG_DIR/api.log"

  warn "API health check failed on port $port"
  if is_service_running api; then
    log "api process is running (pid $(read_pid api))"
  else
    warn "api process is NOT running"
  fi

  if command -v ss >/dev/null 2>&1; then
    log "Listeners on :${port}:"
    ss -tlnp 2>/dev/null | grep ":${port} " || warn "nothing listening on ${port}"
  fi

  show_log_tail "$logfile" 50

  cat <<EOF
[prod] Common fixes:
  - Port in use:        pnpm dev:stop   OR   fuser -k ${port}/tcp
  - MongoDB unreachable: check MONGODB_URI in .env (docker: pnpm prod:infra:up)
  - Missing build:      pnpm build:prod
  - See full log:       tail -f ${logfile}
  - Diagnose:           pnpm prod:diagnose
EOF
}

wait_for_api_health() {
  local port=${1:-3000}
  local timeout=${2:-120}
  local i=0
  log "Waiting for API health on port $port (up to ${timeout}s)..."
  while [[ $i -lt $timeout ]]; do
    if curl -sf "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
      log "API health OK"
      return 0
    fi
    if (( i > 0 && i % 10 == 0 )); then
      if ! is_service_running api; then
        diagnose_api_failure "$port"
        die "API process exited before becoming healthy"
      fi
      log "Still waiting for /health (${i}s elapsed)..."
    fi
    sleep 2
    i=$((i + 2))
  done
  diagnose_api_failure "$port"
  die "API did not become healthy within ${timeout}s"
}

verify_production_builds() {
  local name entry
  local missing=0
  for name in "${PROD_SERVICES[@]}"; do
    entry="$(service_entry "$name")"
    if [[ ! -f "$entry" ]]; then
      warn "Missing build output: $entry"
      missing=1
    fi
  done
  if [[ $missing -eq 1 ]]; then
    die "Build outputs missing — run: pnpm build:prod"
  fi
}

preflight_datastores() {
  load_env_defaults
  local mongo_uri redis_url
  mongo_uri="$(env_val MONGODB_URI "")"
  redis_url="$(env_val REDIS_URL "")"

  if [[ "$mongo_uri" == *127.0.0.1* || "$mongo_uri" == *localhost* ]]; then
    wait_for_tcp 127.0.0.1 27017 "MongoDB (from MONGODB_URI)" 30
  else
    log "MONGODB_URI is remote — ensure it is reachable from this host"
  fi

  if [[ "$redis_url" == *127.0.0.1* || "$redis_url" == *localhost* ]]; then
    wait_for_tcp 127.0.0.1 6379 "Redis (from REDIS_URL)" 30
  else
    log "REDIS_URL is remote — ensure it is reachable from this host"
  fi
}

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$PROD_COMPOSE_FILE" "$@"
  else
    docker-compose -f "$PROD_COMPOSE_FILE" "$@"
  fi
}

start_infra() {
  require_cmd docker
  log "Starting MongoDB + Redis (docker compose prod)..."
  compose_cmd up -d
  wait_for_tcp 127.0.0.1 27017 "MongoDB" 120
  wait_for_tcp 127.0.0.1 6379 "Redis" 60
}

stop_infra() {
  if [[ -f "$PROD_COMPOSE_FILE" ]]; then
    log "Stopping MongoDB + Redis containers..."
    compose_cmd down || true
  fi
}

start_app_service() {
  local name=$1
  local entry pid logfile
  entry="$(service_entry "$name")"
  pid="$(read_pid "$name" || true)"
  if is_running_pid "$pid"; then
    log "$name already running (pid $pid)"
    return 0
  fi
  if [[ ! -f "$entry" ]]; then
    die "Missing $entry — run pnpm build:prod"
  fi

  logfile="$PROD_LOG_DIR/$name.log"
  log "Starting $name → $logfile"
  (
    cd "$PROD_ROOT"
    exec node "$entry"
  ) >>"$logfile" 2>&1 &
  pid=$!
  echo "$pid" >"$PROD_PID_DIR/$name.pid"
  sleep 2
  if ! is_running_pid "$pid"; then
    show_log_tail "$logfile" 30
    die "$name exited immediately — see $logfile"
  fi
  log "$name started (pid $pid)"
}

stop_app_service() {
  local name=$1
  local pid
  pid="$(read_pid "$name" || true)"
  if [[ -z "$pid" ]]; then
    return 0
  fi
  if is_running_pid "$pid"; then
    log "Stopping $name (pid $pid)..."
    kill "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      is_running_pid "$pid" || break
      sleep 1
    done
    if is_running_pid "$pid"; then
      warn "Force-killing $name (pid $pid)"
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$PROD_PID_DIR/$name.pid"
}

start_all_apps() {
  local name
  verify_production_builds
  preflight_datastores
  for name in "${PROD_SERVICES[@]}"; do
    start_app_service "$name"
  done
  log "All services launched — API may take up to 30s to connect to MongoDB and listen"
}

stop_all_apps() {
  local entry
  # Stop API first, then workers, SMTP last
  for entry in api event-dispatcher attachment-worker parser-worker smtp-server; do
    stop_app_service "$entry"
  done
  stop_app_service admin-ui || true
}

start_admin_ui() {
  local skip_build="${PROD_UI_SKIP_BUILD:-0}"
  local port="${ADMIN_UI_PORT:-5173}"
  local api_port="${API_PORT:-3000}"
  local api_url
  api_url="$(env_val VITE_API_URL "")"
  local pid
  pid="$(read_pid admin-ui || true)"
  if is_running_pid "$pid"; then
    log "admin-ui already running (pid $pid)"
    return 0
  fi

  if [[ "$skip_build" -eq 0 ]]; then
    if [[ -n "$api_url" ]]; then
      log "Building admin UI (VITE_API_URL=${api_url})..."
      (
        cd "$PROD_ROOT"
        export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"
        VITE_API_URL="$api_url" pnpm --filter @arivu/admin-ui build
      )
    else
      log "Building admin UI (API via /api proxy → 127.0.0.1:${api_port})..."
      (
        cd "$PROD_ROOT"
        export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"
        pnpm --filter @arivu/admin-ui build
      )
    fi
  else
    log "Skipping admin UI build (PROD_UI_SKIP_BUILD=1)"
    if [[ ! -d "$PROD_ROOT/apps/admin-ui/dist" ]]; then
      die "No apps/admin-ui/dist — run prod:ui:up without --skip-build first"
    fi
  fi

  local logfile="$PROD_LOG_DIR/admin-ui.log"
  log "Starting admin UI preview on port $port → $logfile"
  (
    cd "$PROD_ROOT/apps/admin-ui"
    exec pnpm exec vite preview --host 0.0.0.0 --port "$port"
  ) >>"$logfile" 2>&1 &
  pid=$!
  echo "$pid" >"$PROD_PID_DIR/admin-ui.pid"
  sleep 2
  if ! is_running_pid "$pid"; then
    die "admin-ui exited immediately. Check $logfile"
  fi
  log "admin-ui started (pid $pid)"
}

print_summary() {
  load_env_defaults
  cat <<EOF

================================================================================
  Arivu Inbound Parser — production stack is running
================================================================================
  Repo:        $PROD_ROOT
  Logs:        $PROD_LOG_DIR/
  PIDs:        $PROD_PID_DIR/

  API health:  curl -sf http://127.0.0.1:${API_PORT}/health
  Admin API:   http://127.0.0.1:${API_PORT}/admin/metrics
  SMTP:        port ${SMTP_PORT} (ensure firewall / MX routing)
EOF
  if [[ -f "$PROD_PID_DIR/admin-ui.pid" ]]; then
    echo "  Admin UI:    http://127.0.0.1:${ADMIN_UI_PORT:-5173}/"
  fi
  cat <<EOF

  Stop:        pnpm prod:down
  Status:      pnpm prod:status
  Admin UI:    pnpm prod:ui:up   (step 2 — after backends are up)

  Next: CRM provisions mailboxes via POST /integrations/v1/mailboxes (docs/CRM-PROVISIONING.md)
        then send a test message and confirm CRM webhook.
  Docs: docs/PRODUCTION-DEPLOYMENT.md
================================================================================
EOF
}
