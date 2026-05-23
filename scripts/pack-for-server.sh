#!/usr/bin/env bash
# Build on a dev machine, then pack files needed on the server (no tsc on server).
#
# Usage (laptop):
#   ./scripts/pack-for-server.sh
#   scp /tmp/arivu-parser-deploy.tar.gz ubuntu@your-server:~/
#
# Usage (server):
#   cd ~
#   rm -rf arivu-inbound-parser && mkdir arivu-inbound-parser && cd arivu-inbound-parser
#   tar -xzf ../arivu-parser-deploy.tar.gz
#   pnpm install --frozen-lockfile || pnpm install
#   cp .env.example .env   # if needed, then edit .env
#   pnpm prod:up -- --skip-build
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="${1:-/tmp/arivu-parser-deploy.tar.gz}"

log() { printf '[pack] %s\n' "$*"; }

log "Building on this machine..."
bash "$ROOT/scripts/build-prod.sh"

log "Creating archive → $OUT"
tar -czf "$OUT" \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=apps/admin-ui/node_modules \
  --exclude=.turbo \
  --exclude=logs \
  --exclude=.run \
  \
  package.json \
  pnpm-lock.yaml \
  pnpm-workspace.yaml \
  tsconfig.base.json \
  tsconfig.prod.json \
  docker-compose.prod.yml \
  .env.example \
  packages \
  apps \
  scripts \
  docs

log "Done. Copy to server:"
echo "  scp $OUT ubuntu@<server>:~/"
echo ""
echo "On server:"
echo "  mkdir -p ~/arivu-inbound-parser && cd ~/arivu-inbound-parser"
echo "  tar -xzf ~/arivu-parser-deploy.tar.gz"
echo "  pnpm install"
echo "  nano .env"
echo "  pnpm prod:up -- --skip-build"
