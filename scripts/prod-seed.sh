#!/usr/bin/env bash
# Seed a production tenant + mailbox in MongoDB (see scripts/prod-seed.ts).
set -euo pipefail

PROD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/prod-common.sh
source "$PROD_ROOT/scripts/lib/prod-common.sh"

require_node
require_cmd pnpm
require_env_file

log "Production seed (MongoDB tenant + mailbox)"
(
  cd "$PROD_ROOT"
  exec pnpm exec tsx scripts/prod-seed.ts "$@"
)
