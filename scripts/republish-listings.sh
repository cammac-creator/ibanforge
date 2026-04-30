#!/usr/bin/env bash
# republish-listings.sh — Manual companion to .github/workflows/release-publish.yml
#
# Run this locally when you want to push the latest version to every listing
# without waiting for the GitHub Actions tag-triggered job. Useful for:
#   - Testing the publish flow without creating a tag
#   - One-off re-publication when a platform fell out of sync
#   - Filling a coverage gap after the CI runs
#
# Usage:
#   ./scripts/republish-listings.sh [--dry-run]
#
# Reads the version from mcp/package.json — keep that as the single source
# of truth for the MCP package + npm + MCP Registry. The Python SDK has
# its own version cadence in sdks/python/pyproject.toml.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
  echo "[dry-run] No publishes will happen — only diagnostics."
fi

run() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "  [dry-run] would run: $*"
  else
    echo "  $ $*"
    "$@"
  fi
}

VERSION=$(node -p "require('./mcp/package.json').version")
echo "═══ Republishing IBANforge listings @ v$VERSION ═══"
echo

# ─── 1. npm ibanforge-mcp ────────────────────────────────────────────────
echo "▶ npm: ibanforge-mcp"
PUBLISHED=$(npm view ibanforge-mcp@"$VERSION" version 2>/dev/null || echo "")
if [ "$PUBLISHED" = "$VERSION" ]; then
  echo "  ✓ already on npm (idempotent)"
else
  run bash -c "cd mcp && npm ci && npm run build && npm publish --access public"
fi
echo

# ─── 2. npm @ibanforge/sdk ───────────────────────────────────────────────
if [ -f sdks/typescript/package.json ]; then
  TS_VERSION=$(node -p "require('./sdks/typescript/package.json').version")
  echo "▶ npm: @ibanforge/sdk @ v$TS_VERSION"
  PUBLISHED=$(npm view @ibanforge/sdk@"$TS_VERSION" version 2>/dev/null || echo "")
  if [ "$PUBLISHED" = "$TS_VERSION" ]; then
    echo "  ✓ already on npm (idempotent)"
  else
    run bash -c "cd sdks/typescript && npm ci && npm run build && npm publish --access public"
  fi
else
  echo "▶ npm: @ibanforge/sdk — sdks/typescript/package.json missing, skipping"
fi
echo

# ─── 3. PyPI ibanforge (Python) ──────────────────────────────────────────
if [ -f sdks/python/pyproject.toml ]; then
  PY_VERSION=$(grep -m1 '^version' sdks/python/pyproject.toml | cut -d'"' -f2)
  echo "▶ PyPI: ibanforge @ v$PY_VERSION"
  PUBLISHED=$(curl -s "https://pypi.org/pypi/ibanforge/$PY_VERSION/json" -o /dev/null -w "%{http_code}")
  if [ "$PUBLISHED" = "200" ]; then
    echo "  ✓ already on PyPI (idempotent)"
  elif [ -z "${PYPI_TOKEN:-}" ]; then
    echo "  ⚠ PYPI_TOKEN not set in env — skipping PyPI publish"
    echo "    (token at https://pypi.org/manage/account/token/)"
  else
    run bash -c "cd sdks/python && python -m build && python -m twine upload dist/* --username __token__ --password \"\$PYPI_TOKEN\" --skip-existing"
  fi
else
  echo "▶ PyPI: sdks/python/pyproject.toml missing, skipping"
fi
echo

# ─── 4. MCP Registry official ────────────────────────────────────────────
echo "▶ MCP Registry: io.github.cammac-creator/ibanforge"
if ! command -v mcp-publisher >/dev/null 2>&1; then
  echo "  ⚠ mcp-publisher CLI not installed — install: brew install mcp-publisher"
elif [ ! -f mcp/.mcpregistry_registry_token ] && [ -z "${MCP_REGISTRY_TOKEN:-}" ]; then
  echo "  ⚠ no token (mcp/.mcpregistry_registry_token absent and \$MCP_REGISTRY_TOKEN unset)"
  echo "    Run: cd mcp && mcp-publisher login github  (then re-run this script)"
else
  PUBLISHED=$(curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=ibanforge" | python3 -c "
import sys, json
d=json.load(sys.stdin)
versions=[s.get('server',{}).get('version') for s in d.get('servers',[])]
print('1' if '$VERSION' in versions else '0')
" 2>/dev/null || echo "0")
  if [ "$PUBLISHED" = "1" ]; then
    echo "  ✓ v$VERSION already on MCP Registry"
  else
    run bash -c "cd mcp && mcp-publisher publish"
  fi
fi
echo

# ─── 5. Platforms that don't have an API ─────────────────────────────────
cat <<EOF
▶ Manual refresh required (no API):

  □ Smithery       https://smithery.ai/server/ibanforge/ibanforge
                   → Click "Redeploy from npm" on the dashboard
  □ MCP.so         https://mcp.so/server/ibanforge
                   → "Refresh from GitHub" on the dashboard
  □ RapidAPI       https://rapidapi.com/  → your IBANforge listing
                   → Re-import OpenAPI from https://api.ibanforge.com/openapi.json
  □ DevHunt        https://devhunt.org/  → search IBANforge → Edit
  □ Glama          https://glama.ai/mcp/servers/cammac-creator/ibanforge/admin/dockerfile
                   → Build + Make Release (only when the build spec changes)

▶ Auto-indexed (passive):

  • Coinbase Bazaar  — re-indexed after each x402 settlement
  • agentic.market   — pulls from Bazaar; ~24h lag

═══ Summary @ v$VERSION ═══
   API-published:   npm × 2, PyPI, MCP Registry
   Manual checklist: 5 platforms (1-5 min each)
   Total time when scripted: ~5 min API + ~10 min manual

EOF
