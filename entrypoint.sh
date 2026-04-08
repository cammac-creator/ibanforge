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

# Always copy latest read-only databases from build
cp /app/data-seed/bic.sqlite /app/data/bic.sqlite
cp /app/data-seed/compliance.sqlite /app/data/compliance.sqlite

echo "[entrypoint] Read-only databases copied to volume."

if [ -f /app/data/stats.sqlite ]; then
  echo "[entrypoint] stats.sqlite exists on volume — preserved."
else
  echo "[entrypoint] stats.sqlite not found — app will create it on first request."
fi

exec "$@"
