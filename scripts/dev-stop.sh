#!/usr/bin/env bash
# Stop dev processes holding API (3000) and SMTP (2525) ports.
set -euo pipefail

for port in 3000 2525; do
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" 2>/dev/null && echo "Freed port ${port}" || true
  elif command -v lsof >/dev/null 2>&1; then
    pid=$(lsof -ti ":${port}" 2>/dev/null || true)
    if [ -n "${pid}" ]; then
      kill ${pid} 2>/dev/null && echo "Freed port ${port} (pid ${pid})" || true
    fi
  fi
done

echo "Done. If ports are still busy, run: ss -tlnp | grep -E '3000|2525'"
