#!/usr/bin/env bash
# Production build — optimized for small VMs (single `tsc -b` pass).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"

log() { printf '[build] %s\n' "$*"; }
die() { printf '[build] ERROR: %s\n' "$*" >&2; exit 1; }

APPS=(smtp-server parser-worker attachment-worker event-dispatcher api)

check_swap() {
  local swap_total
  swap_total="$(awk '/SwapTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  if [[ "$swap_total" -lt 1048576 ]]; then
    warn() { printf '[build] WARNING: %s\n' "$*" >&2; }
    warn "Less than 1GB swap detected. On 1–2GB RAM VMs, build may look stuck for 10+ minutes."
    warn "Add swap: sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile"
  fi
}

verify_dist() {
  local app entry
  for app in "${APPS[@]}"; do
    entry="$ROOT/apps/${app}/dist/index.js"
    if [[ ! -f "$entry" ]]; then
      die "Missing $entry after build"
    fi
    log "  OK $entry"
  done
}

check_swap

log "Building with tsc -b (one pass, all packages + apps)..."
log "Started at $(date -Is). On a 1GB VM this can take 10–20 minutes — watch: ps aux | grep tsc"
log ""

if ! pnpm exec tsc -b tsconfig.prod.json --pretty false 2>&1 | while IFS= read -r line; do
  printf '[build] %s\n' "$line"
done; then
  die "tsc -b failed"
fi

log ""
log "Verifying app outputs..."
verify_dist
log "Build finished at $(date -Is)"
