#!/usr/bin/env bash
# Build and start production stack (infra + all Node services + optional admin UI).
#
# Usage:
#   ./scripts/prod-up.sh              # full setup
#   ./scripts/prod-up.sh --skip-infra   # use existing MongoDB/Redis
#   ./scripts/prod-up.sh --skip-ui      # no admin UI
#   ./scripts/prod-up.sh --skip-build   # reuse existing dist/
#
set -euo pipefail

PROD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/prod-common.sh
source "$PROD_ROOT/scripts/lib/prod-common.sh"

SKIP_INFRA=0
SKIP_BUILD=0
SKIP_UI=0
SKIP_STORAGE_CHECK=0
SKIP_INSTALL=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

  --skip-infra          Do not start docker-compose.prod.yml (use managed Mongo/Redis)
  --skip-build          Skip pnpm build (dist must already exist)
  --skip-ui             Do not build/start admin UI
  --skip-storage-check  Skip OCI storage:check (not recommended)
  --skip-install        Skip pnpm install
  -h, --help            Show this help

Environment:
  Copy .env.example → .env and set NODE_ENV=production, OCI keys, CRM_WEBHOOK_URL, etc.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-infra) SKIP_INFRA=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --skip-ui) SKIP_UI=1 ;;
    --skip-storage-check) SKIP_STORAGE_CHECK=1 ;;
    --skip-install) SKIP_INSTALL=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1 (use --help)"
      ;;
  esac
  shift
done

log "Arivu Inbound Parser — production up"
log "Root: $PROD_ROOT"

require_node
require_cmd pnpm
require_cmd curl
require_env_file
load_env_defaults
ensure_dirs

if [[ "${NODE_ENV:-}" != "production" ]]; then
  warn "NODE_ENV is '${NODE_ENV:-unset}' (recommended: production)"
fi

if [[ "$SKIP_INSTALL" -eq 0 ]]; then
  log "Installing dependencies..."
  (
    cd "$PROD_ROOT"
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install
  )
fi

if [[ "$SKIP_INFRA" -eq 0 ]]; then
  start_infra
else
  log "Skipping infra (--skip-infra); expecting MONGODB_URI and REDIS_URL in .env"
fi

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  log "Building packages and apps..."
  (
    cd "$PROD_ROOT"
    pnpm build
  )
fi

if [[ "$SKIP_STORAGE_CHECK" -eq 0 ]]; then
  log "Verifying OCI Object Storage..."
  (
    cd "$PROD_ROOT"
    pnpm storage:check
  )
fi

# Stop stale processes from a previous run (same PID dir)
stop_all_apps

log "Starting application services..."
start_all_apps

if [[ "$SKIP_UI" -eq 0 ]]; then
  start_admin_ui
fi

wait_for_api_health "${API_PORT:-3000}" 90
print_summary
