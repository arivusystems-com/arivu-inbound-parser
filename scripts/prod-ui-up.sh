#!/usr/bin/env bash
# Step 2 (Option 2): build and start admin UI after backends are running.
#
# Usage:
#   pnpm prod:up              # step 1 — backends only (default)
#   pnpm prod:ui:up           # step 2 — this script
#
# Options:
#   --skip-build   reuse existing apps/admin-ui/dist
#
set -euo pipefail

PROD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/prod-common.sh
source "$PROD_ROOT/scripts/lib/prod-common.sh"

PROD_UI_SKIP_BUILD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) PROD_UI_SKIP_BUILD=1 ;;
    -h | --help)
      cat <<EOF
Usage: $(basename "$0") [--skip-build]

  Build and start the operator admin UI (vite preview on ADMIN_UI_PORT, default 5173).

  Prerequisites:
    - pnpm prod:up completed (API healthy on API_PORT)
    - Optional .env: VITE_API_URL for browser → API (default http://127.0.0.1:3000)

  Examples:
    pnpm prod:ui:up
    pnpm prod:ui:up -- --skip-build
EOF
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
  shift
done

export PROD_UI_SKIP_BUILD

require_node
require_cmd pnpm
require_cmd curl
require_env_file
load_env_defaults
ensure_dirs

log "Admin UI — production start (Option 2)"

if ! curl -sf "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1; then
  die "API is not healthy on port ${API_PORT}. Run pnpm prod:up first."
fi

start_admin_ui

cat <<EOF

================================================================================
  Admin UI is running
================================================================================
  Local:     http://127.0.0.1:${ADMIN_UI_PORT:-5173}/
  API:       http://127.0.0.1:${API_PORT}/health

  Remote access: use SSH tunnel, do not expose :5173 publicly without auth.
    ssh -L 5173:127.0.0.1:5173 -L 3000:127.0.0.1:${API_PORT} user@<server>

  Logs:      ${PROD_LOG_DIR}/admin-ui.log
  Stop UI:   pnpm prod:ui:down
================================================================================
EOF
