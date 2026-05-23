#!/usr/bin/env bash
# Shared helpers for production scripts. Source from scripts/*.sh — do not execute directly.

set -euo pipefail

if [[ -z "${PROD_ROOT:-}" ]]; then
  PROD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi

PROD_PID_DIR="${PROD_PID_DIR:-$PROD_ROOT/.run/prod}"
PROD_LOG_DIR="${PROD_LOG_DIR:-$PROD_ROOT/logs}"
PROD_COMPOSE_FILE="${PROD_COMPOSE_FILE:-$PROD_ROOT/docker-compose.prod.yml}"

PROD_SERVICES=(
  'smtp-server:@arivu/smtp-server'
  'parser-worker:@arivu/parser-worker'
  'attachment-worker:@arivu/attachment-worker'
  'event-dispatcher:@arivu/event-dispatcher'
  'api:@arivu/api'
)

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

wait_for_api_health() {
  local port=${1:-3000}
  local timeout=${2:-60}
  local i=0
  log "Waiting for API health on port $port..."
  while [[ $i -lt $timeout ]]; do
    if curl -sf "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
      log "API health OK"
      return 0
    fi
    sleep 2
    i=$((i + 2))
  done
  die "API did not become healthy on port $port (see $PROD_LOG_DIR/api.log)"
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
  local name=$1 filter=$2
  local pid
  pid="$(read_pid "$name" || true)"
  if is_running_pid "$pid"; then
    log "$name already running (pid $pid)"
    return 0
  fi

  local logfile="$PROD_LOG_DIR/$name.log"
  log "Starting $name → $logfile"
  (
    cd "$PROD_ROOT"
    exec pnpm --filter "$filter" start
  ) >>"$logfile" 2>&1 &
  pid=$!
  echo "$pid" >"$PROD_PID_DIR/$name.pid"
  sleep 1
  if ! is_running_pid "$pid"; then
    die "$name exited immediately. Check $logfile"
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
  local entry
  for entry in "${PROD_SERVICES[@]}"; do
    local name="${entry%%:*}"
    local filter="${entry##*:}"
    start_app_service "$name" "$filter"
  done
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
  local port="${ADMIN_UI_PORT:-5173}"
  local api_port="${API_PORT:-3000}"
  local pid
  pid="$(read_pid admin-ui || true)"
  if is_running_pid "$pid"; then
    log "admin-ui already running (pid $pid)"
    return 0
  fi

  log "Building admin UI (API at http://127.0.0.1:${api_port})..."
  (
    cd "$PROD_ROOT"
    VITE_API_URL="http://127.0.0.1:${api_port}" pnpm --filter @arivu/admin-ui build
  )

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

  Next: CRM provisions mailboxes via POST /integrations/v1/mailboxes (docs/CRM-PROVISIONING.md)
        then send a test message and confirm CRM webhook.
  Docs: docs/PRODUCTION-DEPLOYMENT.md
================================================================================
EOF
}
