#!/usr/bin/env bash
# Show production stack status (PIDs, infra, API health).
set -euo pipefail

PROD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/prod-common.sh
source "$PROD_ROOT/scripts/lib/prod-common.sh"

if [[ -f "$PROD_ROOT/.env" ]]; then
  load_env_defaults
else
  API_PORT=3000
fi

log "Status (root: $PROD_ROOT)"
echo

printf '%-22s %s\n' "SERVICE" "STATE"
printf '%-22s %s\n' "-------" "-----"

show_service() {
  local name=$1
  local pid
  pid="$(read_pid "$name" || true)"
  if is_running_pid "$pid"; then
    printf '%-22s running (pid %s)\n' "$name" "$pid"
  else
    printf '%-22s stopped\n' "$name"
    [[ -f "$PROD_PID_DIR/$name.pid" ]] && rm -f "$PROD_PID_DIR/$name.pid"
  fi
}

for name in "${PROD_SERVICES[@]}"; do
  show_service "$name"
done
show_service admin-ui

echo
if command -v docker >/dev/null 2>&1 && [[ -f "$PROD_COMPOSE_FILE" ]]; then
  log "Docker (prod infra):"
  compose_cmd ps 2>/dev/null || true
  echo
fi

if curl -sf "http://127.0.0.1:${API_PORT}/health/ready" 2>/dev/null; then
  echo
  log "API readiness: OK (MongoDB + Redis)"
elif curl -sf "http://127.0.0.1:${API_PORT}/health" 2>/dev/null; then
  echo
  warn "API /health OK but /health/ready failed — MongoDB or Redis may be unreachable"
else
  warn "API health: not reachable on port ${API_PORT}"
fi

echo
log "Logs: $PROD_LOG_DIR/"
