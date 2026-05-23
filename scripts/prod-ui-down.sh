#!/usr/bin/env bash
# Stop admin UI only (backends keep running).
set -euo pipefail

PROD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/prod-common.sh
source "$PROD_ROOT/scripts/lib/prod-common.sh"

log "Stopping admin UI..."
stop_app_service admin-ui || true
log "Done. Backends still running (pnpm prod:status)."
