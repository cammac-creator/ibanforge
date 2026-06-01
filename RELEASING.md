# Releasing IBANforge

This repo publishes to **four** places. Two are fully automated; **npm is manual**
because npm now enforces a live 2FA challenge that no CI token can pass.

| Target | How | Auth |
|---|---|---|
| PyPI `ibanforge` | **automatic** (CI) | `PYPI_TOKEN` repo secret |
| MCP Registry | **automatic** (CI) | GitHub Actions OIDC (no secret) |
| npm `ibanforge-mcp` | **manual** (Touch ID) | interactive `npm login` |
| npm `@ibanforge/sdk` | **manual** (Touch ID) | interactive `npm login` |

> **Why npm is manual.** Since 2026 npm enforces a "2FA approval gate" (staged
> publishing): finalizing a publish requires a live, interactive 2FA challenge.
> Automation/granular tokens — even with "bypass 2FA" enabled — fail with
> `npm error code EOTP`, both in CI and locally. This is by design (anti
> supply-chain), so there is no token that makes npm publish non-interactively.

## Step 0 — bump the version (one number, six files)

All versions must match. The six locations:

- `package.json`
- `mcp/package.json`
- `mcp/server.json` (top-level `version` **and** `packages[].version`)
- `sdks/typescript/package.json` **and** the `const VERSION` in `sdks/typescript/src/index.ts`
- `sdks/python/ibanforge/_version.py`
- `sdks/python/pyproject.toml`

Then verify everything is green:

```bash
npm run check                      # backend: typecheck + lint + tests
(cd mcp && npm run build)
(cd sdks/typescript && npm run build)
(cd sdks/python && .venv/bin/python -m pytest -q)
```

Commit and push the bump.

## Step 1 — publish npm by hand (Touch ID)

The MCP Registry validates that the npm package version exists, so **npm must go
first**. In your Terminal (not CI):

```bash
# If your npm session has expired (it lasts a few days), log in first:
npm login            # press Enter, approve in the browser / Touch ID

cd ~/ibanforge/mcp && npm publish --access public
# → + ibanforge-mcp@X.Y.Z

cd ~/ibanforge/sdks/typescript && npm run build && npm publish --access public
# → + @ibanforge/sdk@X.Y.Z
```

If a publish reopens a browser "approve this publish" page, approve it. If it
times out, just re-run the `npm publish` command.

## Step 2 — let CI publish PyPI + MCP Registry

Either push a tag, or trigger the workflow manually (preferred — it runs the
workflow from `main`, including any workflow fix):

```bash
# tag form
git tag vX.Y.Z && git push origin vX.Y.Z

# or manual dispatch (recommended)
gh workflow run release-publish.yml --ref main -f version=X.Y.Z
```

Watch it:

```bash
gh run watch $(gh run list --workflow=release-publish.yml --limit 1 --json databaseId -q '.[0].databaseId')
```

The npm steps are **best-effort** and will warn-and-continue (EOTP). PyPI and the
MCP Registry steps should be **green** now that npm has the version.

## Step 3 — verify all four

```bash
npm view ibanforge-mcp version
npm view @ibanforge/sdk version
curl -s https://pypi.org/pypi/ibanforge/json | python3 -c 'import sys,json;print(json.load(sys.stdin)["info"]["version"])'
curl -s 'https://registry.modelcontextprotocol.io/v0/servers?search=io.github.cammac-creator/ibanforge' \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(next((s["server"]["version"] for s in d.get("servers",[]) if s.get("_meta",{}).get("io.modelcontextprotocol.registry/official",{}).get("isLatest")),"?"))'
```

All four should print `X.Y.Z`.

## Step 4 — manual-refresh platforms (no publish API)

The release run's summary lists them: Smithery, MCP.so, RapidAPI, DevHunt, Glama,
Coinbase Bazaar. Most re-scan from npm within 24–48h; refresh by hand if needed.

## Troubleshooting

- **`EOTP` on npm publish** — expected; it's the 2FA gate. Approve interactively
  or re-run. There is no CI workaround.
- **`E404 ... do not have permission` on npm publish** — your `npm login`
  expired. Run `npm login` and retry.
- **MCP Registry: `NPM package 'ibanforge-mcp' not found (404)`** — you ran the
  workflow before npm had the new version. Publish npm first (Step 1), then
  re-run the workflow.
- **`mcp-publisher: command not found`** — the old install script 404s; the
  workflow now downloads the release binary. If it breaks again, check the
  latest asset name at github.com/modelcontextprotocol/registry/releases.
