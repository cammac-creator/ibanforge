#!/bin/sh
# entrypoint.sh — Initialize persistent volume data on startup
#
# /app/data-seed/ contains read-only databases baked into the Docker image.
# /app/data/       is the Railway persistent volume mount point.
#
# Read-only DBs (bic, compliance) are always refreshed from the build.
# stats.sqlite is NEVER overwritten — it holds API keys and usage data.

set -e

mkdir -p /app/data

# Detect whether /app/data is a real persistent volume or just an ephemeral
# directory in the container filesystem. Railway volumes appear as a separate
# mount point. If /app/data shares the same device as /app, the volume is NOT
# attached and stats.sqlite will be wiped on every redeploy.
APP_DEV=$(stat -c '%d' /app 2>/dev/null || echo "")
DATA_DEV=$(stat -c '%d' /app/data 2>/dev/null || echo "")
if [ -n "$APP_DEV" ] && [ "$APP_DEV" = "$DATA_DEV" ]; then
  echo "[entrypoint] WARNING: /app/data is NOT on a persistent volume — stats.sqlite will be lost on redeploy. Attach a Railway volume at /app/data."
else
  echo "[entrypoint] /app/data is on a separate volume — persistence OK."
fi

# Always copy latest read-only databases from build
cp /app/data-seed/bic.sqlite /app/data/bic.sqlite
cp /app/data-seed/compliance.sqlite /app/data/compliance.sqlite

echo "[entrypoint] Read-only databases copied to volume."

if [ -f /app/data/stats.sqlite ]; then
  STATS_SIZE=$(stat -c '%s' /app/data/stats.sqlite 2>/dev/null || echo "?")
  echo "[entrypoint] stats.sqlite exists on volume — preserved (${STATS_SIZE} bytes)."
else
  echo "[entrypoint] stats.sqlite not found — app will create it on first request."
fi

exec "$@"
