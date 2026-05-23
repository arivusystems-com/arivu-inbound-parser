#!/usr/bin/env bash
# Pre-flight checks without starting services.
set -euo pipefail

PROD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/prod-common.sh
source "$PROD_ROOT/scripts/lib/prod-common.sh"

log "Production pre-flight checks"
require_node
require_cmd pnpm
require_cmd curl
require_env_file
load_env_defaults

log "Node: $(node -v)"
log "pnpm: $(pnpm -v)"

if command -v docker >/dev/null 2>&1; then
  log "Docker: $(docker --version)"
else
  warn "Docker not found (needed unless --skip-infra and using managed Mongo/Redis)"
fi

if (echo >/dev/tcp/127.0.0.1/27017) 2>/dev/null; then
  log "MongoDB port 27017: reachable"
else
  warn "MongoDB port 27017: not reachable (start infra or point MONGODB_URI elsewhere)"
fi

if (echo >/dev/tcp/127.0.0.1/6379) 2>/dev/null; then
  log "Redis port 6379: reachable"
else
  warn "Redis port 6379: not reachable"
fi

log "Running storage:check..."
(
  cd "$PROD_ROOT"
  pnpm storage:check
)

if curl -sf "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1; then
  log "API already running and healthy on port ${API_PORT}"
else
  log "API not running (expected before prod-up)"
fi

log "Pre-flight checks passed."
