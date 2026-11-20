#!/bin/sh
# StackDock container entrypoint (runs under tini as PID 1).
set -eu

if [ "${MIGRATE_ON_START:-true}" = "true" ]; then
  echo "[stackdock] Applying database migrations…"
  (cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy)
fi

mkdir -p "${DATA_DIR:-/data}"
echo "[stackdock] Starting StackDock"
exec node /app/apps/api/dist/main.js
