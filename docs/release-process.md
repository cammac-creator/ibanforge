# Release Process

How to ship a new version of IBANforge so every public listing stays fresh.

## TL;DR

```bash
# 1. Bump the version in mcp/package.json (and sdks/python/pyproject.toml if the SDK changed)
vim mcp/package.json
git add . && git commit -m "chore: bump to vX.Y.Z"

# 2. Tag and push — this triggers .github/workflows/release-publish.yml
git tag vX.Y.Z
git push origin main vX.Y.Z

# 3. Wait ~3-5 min for the workflow to publish to npm + PyPI + MCP Registry

# 4. Open the manual-refresh checklist that the workflow prints in the job summary
#    (Smithery, MCP.so, RapidAPI, DevHunt, Glama). 5-10 min total.
```

That's it. Single source of truth for the version is `mcp/package.json`. Everything else aligns automatically.

## What runs automatically (CI-driven)

| Platform | Mechanism | Latency |
|---|---|---|
| **npm `ibanforge-mcp`** | `npm publish` from CI | ~30 sec |
| **npm `@ibanforge/sdk`** | `npm publish` from CI | ~30 sec |
| **PyPI `ibanforge`** | `twine upload` from CI | ~1 min (CDN) |
| **MCP Registry** (`io.github.cammac-creator/ibanforge`) | `mcp-publisher publish` from CI | ~10 sec |

Required GitHub Actions secrets:

| Secret | Where to get it |
|---|---|
| `NPM_TOKEN` | https://www.npmjs.com/settings/<you>/tokens — "Publish" type, scoped to `ibanforge-mcp` and `@ibanforge/sdk` |
| `PYPI_TOKEN` | https://pypi.org/manage/account/token/ — restrict to `ibanforge` after the first publish |
| `MCP_REGISTRY_TOKEN` | Run `cd mcp && mcp-publisher login github` locally; copy `.mcpregistry_registry_token` content |

## What needs a manual click (5-10 min)

These platforms either don't expose a refresh API, or only refresh when an authenticated owner triggers it. The workflow prints a checklist in its job summary — open the URL, click the button.

| Platform | Trigger | URL |
|---|---|---|
| **Smithery** | "Redeploy from npm" | https://smithery.ai/server/ibanforge/ibanforge |
| **MCP.so** | "Refresh from GitHub" | https://mcp.so/server/ibanforge |
| **RapidAPI** | Re-import OpenAPI | https://rapidapi.com/ → IBANforge listing |
| **DevHunt** | Edit description / screenshot | https://devhunt.org/ → IBANforge |
| **Glama** | Build + Make Release | https://glama.ai/mcp/servers/cammac-creator/ibanforge/admin/dockerfile |

## What re-indexes itself (no action needed)

| Platform | Mechanism |
|---|---|
| **Coinbase Bazaar** (`api.cdp.coinbase.com`) | Auto-indexed after the next paid x402 settlement |
| **agentic.market** | Pulls from Bazaar; ~24h lag |
| **Google Search** | Auto-crawl + sitemap.xml |
| **GitHub repo card** | Auto-refresh on push |

## Manual fallback — `scripts/republish-listings.sh`

Use it when:
- You want to test the publish flow without creating a tag
- A platform fell out of sync after a release
- You're republishing the same version (idempotent)

```bash
# Dry-run first
./scripts/republish-listings.sh --dry-run

# Then actually publish
export PYPI_TOKEN=pypi-...
export MCP_REGISTRY_TOKEN=...
./scripts/republish-listings.sh
```

## When did each platform last refresh?

You can audit the staleness with:

```bash
# npm
npm view ibanforge-mcp time.modified
npm view @ibanforge/sdk time.modified

# PyPI
curl -s 'https://pypi.org/pypi/ibanforge/json' | python3 -c 'import sys,json; d=json.load(sys.stdin); print("ibanforge", d["info"]["version"], "uploaded", list(d["releases"][d["info"]["version"]])[0]["upload_time"])'

# MCP Registry
curl -s 'https://registry.modelcontextprotocol.io/v0/servers?search=ibanforge' | python3 -m json.tool

# Glama
curl -s 'https://glama.ai/api/mcp/v1/servers/cammac-creator/ibanforge' | python3 -m json.tool
```

## Why this matters

A platform showing **3 tools instead of 5** or **39K BICs instead of 121K** doesn't just look bad — it actively misleads agents that scan the description for capability signals. They will pick a competitor whose listing claims more, even if the actual API is identical.

Keeping all listings fresh is part of distribution, not maintenance.
