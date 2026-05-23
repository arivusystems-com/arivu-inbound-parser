#!/usr/bin/env bash
# Quick diagnostics when prod-up hangs or API health fails.
set -euo pipefail

PROD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/prod-common.sh
source "$PROD_ROOT/scripts/lib/prod-common.sh"

load_env_defaults 2>/dev/null || API_PORT=3000

log "Diagnostics (root: $PROD_ROOT)"
echo

printf '## Memory\n'
free -h 2>/dev/null || true
echo

printf '## Docker infra\n'
if command -v docker >/dev/null 2>&1; then
  compose_cmd ps 2>/dev/null || docker ps --filter name=arivu 2>/dev/null || true
else
  echo "docker not installed"
fi
echo

printf '## Service PIDs\n'
for name in "${PROD_SERVICES[@]}"; do
  pid="$(read_pid "$name" || true)"
  if is_running_pid "$pid"; then
    echo "  $name: running (pid $pid)"
  else
    echo "  $name: stopped"
  fi
done
echo

printf '## Port %s\n' "$API_PORT"
if command -v ss >/dev/null 2>&1; then
  ss -tlnp | grep ":${API_PORT} " || echo "  (nothing listening)"
fi
echo

printf '## API health\n'
curl -sv "http://127.0.0.1:${API_PORT}/health" 2>&1 | tail -15 || true
echo

printf '## MongoDB / Redis (local)\n'
(echo >/dev/tcp/127.0.0.1/27017) 2>/dev/null && echo "  MongoDB 27017: open" || echo "  MongoDB 27017: closed"
(echo >/dev/tcp/127.0.0.1/6379) 2>/dev/null && echo "  Redis 6379: open" || echo "  Redis 6379: closed"
echo

printf '## .env (non-secret hints)\n'
grep -E '^(NODE_ENV|API_PORT|MONGODB_URI|REDIS_URL|SMTP_PORT)=' "$PROD_ROOT/.env" 2>/dev/null | sed 's/\(SECRET\|PASSWORD\|KEY\)=[^ ]*/\1=***/ig' || true
echo

for name in api smtp-server parser-worker; do
  f="$PROD_LOG_DIR/$name.log"
  if [[ -f "$f" ]]; then
    printf '## tail %s\n' "$f"
    tail -20 "$f"
    echo
  fi
done
