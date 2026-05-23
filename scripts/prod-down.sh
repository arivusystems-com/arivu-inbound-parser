#!/usr/bin/env bash
# Stop production Node services (and optionally Docker infra).
#
# Usage:
#   ./scripts/prod-down.sh           # stop apps only
#   ./scripts/prod-down.sh --infra   # also stop MongoDB + Redis containers
#
set -euo pipefail

PROD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/prod-common.sh
source "$PROD_ROOT/scripts/lib/prod-common.sh"

WITH_INFRA=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --infra) WITH_INFRA=1 ;;
    -h | --help)
      echo "Usage: $(basename "$0") [--infra]"
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
  shift
done

log "Stopping application services..."
stop_all_apps

if [[ "$WITH_INFRA" -eq 1 ]]; then
  stop_infra
fi

log "Done."
