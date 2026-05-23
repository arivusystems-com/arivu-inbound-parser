#!/usr/bin/env bash
# Reliable production build: all packages, then each app (verifies dist/index.js).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"

log() { printf '[build] %s\n' "$*"; }
die() { printf '[build] ERROR: %s\n' "$*" >&2; exit 1; }

# Order matters for TypeScript project references
PACKAGES=(
  @arivu/types
  @arivu/config
  @arivu/logger
  @arivu/events
  @arivu/routing
  @arivu/database
  @arivu/storage
  @arivu/queue
  @arivu/security
  @arivu/threading
)

APPS=(smtp-server parser-worker attachment-worker event-dispatcher api)

log "Phase 1/2: building ${#PACKAGES[@]} packages..."
for pkg in "${PACKAGES[@]}"; do
  log "  → ${pkg}"
  pnpm --filter "${pkg}" run build
done

log "Phase 2/2: building ${#APPS[@]} apps..."
for app in "${APPS[@]}"; do
  log "  → @arivu/${app}"
  pnpm --filter "@arivu/${app}" run build
  if [[ ! -f "$ROOT/apps/${app}/dist/index.js" ]]; then
    die "Missing apps/${app}/dist/index.js after build"
  fi
done

log "Build OK. Verified:"
for app in "${APPS[@]}"; do
  ls -la "$ROOT/apps/${app}/dist/index.js"
done
