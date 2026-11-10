# Releasing IBANforge

The main release publishes to **four** places, all from CI, in one run, once
the owner has approved it. Three more workflows publish the Java, .NET and n8n
packages, each on its own tag and its own version line, under the same approval.

| Target | Workflow (trigger) | Auth |
|---|---|---|
| npm `ibanforge-mcp` | `release-publish.yml` (`v*.*.*`) | npm trusted publishing (OIDC), provenance |
| npm `@ibanforge/sdk` | `release-publish.yml` (`v*.*.*`) | npm trusted publishing (OIDC), provenance |
| PyPI `ibanforge` | `release-publish.yml` (`v*.*.*`) | `PYPI_TOKEN` secret |
| MCP Registry | `release-publish.yml` (`v*.*.*`) | GitHub Actions OIDC (no secret) |
| npm `n8n-nodes-ibanforge` | `n8n-publish.yml` (`n8n-v*`) | npm trusted publishing (OIDC), provenance |
| NuGet `IBANforge.Sdk` | `dotnet-publish.yml` (`dotnet-v*`) | nuget.org trusted publishing (OIDC) |
| Maven Central `ibanforge-sdk` | `java-publish.yml` (`java-v*`) | Portal token + GPG key (secrets) |

**Since the audit of 2026-11-10 (chantier C13)** nothing reaches a public
registry without the owner's click: every job that publishes runs in the GitHub
environment `publication`, which requires a reviewer, and waits
"Waiting for review" until he approves it. The npm steps are no longer
best-effort: a failed npm publish fails the run, and the run ends by refusing
an npm version without its provenance attestation. Publishing by hand with a
token in `~/.npmrc` is no longer a documented path.

## Once — the repository settings (owner, or the integrator with his consent)

Both live in the repository settings, not in a file. **Create the environment
before any workflow that names it runs**: GitHub creates an environment named in
a workflow that does not exist yet, *without any protection rule*
([Managing environments for deployment](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)),
and the publication would then go out with no approval at all.

**The environment `publication`** — one required reviewer (the owner),
self-review allowed (every actor of this repository is the owner's identity:
forbidding self-review would make every release impossible to approve), and
only `main` and the four release tag patterns may deploy to it:

```bash
OWNER_ID=$(gh api users/cammac-creator --jq .id)
gh api -X PUT repos/cammac-creator/ibanforge/environments/publication --input - <<EOF
{
  "wait_timer": 0,
  "prevent_self_review": false,
  "reviewers": [{ "type": "User", "id": ${OWNER_ID} }],
  "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true }
}
EOF
for policy in branch:main 'tag:v*.*.*' 'tag:java-v*' 'tag:dotnet-v*' 'tag:n8n-v*'; do
  gh api -X POST repos/cammac-creator/ibanforge/environments/publication/deployment-branch-policies \
    -f name="${policy#*:}" -f type="${policy%%:*}"
done
# Check: a required_reviewers rule naming the owner, and the five patterns.
gh api repos/cammac-creator/ibanforge/environments/publication --jq '.protection_rules'
gh api repos/cammac-creator/ibanforge/environments/publication/deployment-branch-policies \
  --jq '.branch_policies[] | .type + " " + .name'
```

**The tag ruleset** — a release tag can be created, never deleted nor moved:

```bash
gh api -X POST repos/cammac-creator/ibanforge/rulesets --input - <<'EOF'
{
  "name": "étiquettes de version : ni suppression, ni réécriture",
  "target": "tag",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["refs/tags/v*", "refs/tags/*-v*"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "update", "parameters": { "update_allows_fetch_and_merge": false } },
    { "type": "non_fast_forward" }
  ]
}
EOF
gh api repos/cammac-creator/ibanforge/rulesets --jq '.[] | [.id, .name, .target, .enforcement] | @tsv'
```

`refs/tags/v*` also covers the old marker tag `village-pause-2026-09-02`. A tag
pushed by mistake now stays: correcting it means disabling the ruleset for the
time of the fix, which is the owner's gesture.

What the approval does not stop: a required reviewer can also approve through
the API ([`POST /repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments`](https://docs.github.com/en/rest/actions/workflow-runs?apiVersion=2022-11-28),
a classic token with the `repo` scope suffices), and the agents of the Mac act
under the owner's identity. The approval stops an accidental tag or dispatch,
and an agent that does not also call that endpoint; closing that last gap means
giving the agents an identity that is not a reviewer, which is the owner's call.

## Step 0a — trusted publishers name the environment (once per package)

The OIDC token a job presents to a registry names its environment. Checked in
each registry's documentation or source, 2026-11-10:

- **npm** — the trusted publisher's *Environment name* is optional, and
  [npm's documentation](https://docs.npmjs.com/trusted-publishers) does not say
  whether a publisher saved **without** an environment accepts a job that runs
  in one. Treat it as unknown: set it. On npmjs.com, logged in as the package
  owner, for **`ibanforge-mcp`**, **`@ibanforge/sdk`** (workflow
  `release-publish.yml`) and **`n8n-nodes-ibanforge`** (workflow
  `n8n-publish.yml`): package → *Settings* → *Publish access* → *Trusted
  publishers*: GitHub Actions · owner `cammac-creator` · repository `ibanforge`
  · workflow filename as above · **environment `publication`**. npm keeps one
  configuration per package: edit it, or revoke and add
  ([`npm trust`](https://docs.npmjs.com/cli/v12/commands/npm-trust/)).
  Do it after the workflows carrying `environment: publication` are on `main`
  and before the next release: a publisher bound to `publication` refuses a
  workflow that does not run in it.
- **NuGet** — nuget.org checks the environment claim only when the policy names
  one: the [documentation](https://learn.microsoft.com/en-us/nuget/nuget-org/trusted-publishing)
  calls the field optional, to fill "if your workflow uses e.g. `environment:
  release` and you want to restrict this policy to that environment", and the
  GitHub validator of nuget.org compares it only when it is set
  ([GitHubTokenPolicyValidator](https://github.com/NuGet/NuGetGallery/blob/63b66c98287c61c7e00fe6aefaff86c0d73ba157/src/NuGetGallery.Services/Authentication/Federated/GitHubTokenPolicyValidator.cs#L291-L304)).
  The existing policy keeps working;
  naming `publication` in it (nuget.org → *Trusted Publishing* → the policy for
  `dotnet-publish.yml`) binds it to the approved path. Recommended, not required.
- **PyPI** — this workflow uploads with the `PYPI_TOKEN` secret, not a trusted
  publisher, so the environment changes nothing. Should PyPI move to trusted
  publishing, a publisher without environment accepts any
  ([warehouse `_check_environment`](https://github.com/pypi/warehouse/blob/6dabfdecf5d600ea1eaf2af11f88ac06e99a7a13/warehouse/oidc/models/github.py#L106-L120));
  name `publication` there too.
- **MCP Registry** — checks the `repository_owner` claim only
  besides issuer and audience
  ([github_oidc.go](https://github.com/modelcontextprotocol/registry/blob/8759d9d8c05993cc18663ec7d4b9f81136c29ae6/internal/api/handlers/v0/auth/github_oidc.go#L113-L132)):
  not concerned.
- **Maven Central** — token and GPG key, no OIDC: not concerned.

## Step 0 — bump the version (one number, seven files)

All versions must match. The seven locations:

- `package.json`
- `server.json` at the repo root (top-level `version` **and** `packages[].version`)
- `mcp/server.json` (top-level `version` **and** `packages[].version`)
- `mcp/package.json`
- `sdks/typescript/package.json` **and** the `const VERSION` in `sdks/typescript/src/index.ts`
- `sdks/python/ibanforge/_version.py`
- `sdks/python/pyproject.toml`

> The root `server.json` is the one this list forgot. It is documentation — only
> `mcp/server.json` is published, because the release workflow runs
> `mcp-publisher` with `working-directory: mcp` — but `src/routes/server-json.test.ts`
> requires the two to agree, so leaving it behind turns the suite red at the worst
> possible moment. Found by the audit of 2026-09-01 (DX-12), where this file said
> six and the repo had seven.

The release workflow refuses a version that does not read `X.Y.Z`, or that
differs from `mcp/package.json` or `sdks/typescript/package.json`.

Then verify everything is green:

```bash
npm run check                      # backend: typecheck + lint + tests
(cd mcp && npm run build)
(cd sdks/typescript && npm run build)
(cd sdks/python && .venv/bin/python -m pytest -q)
```

Commit and push the bump.

## Step 0b — freeze the changelog

Rename the `## [Unreleased]` heading of `CHANGELOG.md` to `## [X.Y.Z] — YYYY-MM-DD`
and open a fresh empty `## [Unreleased]` above it.

Not cosmetic, and not optional: `https://ibanforge.com/changelog` renders this file
straight from the repository, and `frontend/lib/feed.ts` builds the release items of
the RSS feed by matching `^## \[version\] — date`. A version that never gets its
heading is a version that never appears on either surface. That is exactly what
happened to 1.4.4: production served it while the public changelog stopped at 1.4.3
(audit of 2026-09-01, DX-04).

## Step 1 — start the run

Either push a tag, or trigger the workflow manually (preferred — it runs the
workflow from `main`, including any workflow fix):

```bash
# tag form
git tag vX.Y.Z && git push origin vX.Y.Z

# or manual dispatch (recommended)
gh workflow run release-publish.yml --ref main -f version=X.Y.Z
```

The same for the other packages: `java-vX.Y.Z`, `dotnet-vX.Y.Z`, `n8n-vX.Y.Z`
(each must match its own pom, csproj or package.json).

## Step 2 — approve it

The run stops at the `publish` job, "Waiting for review". The owner opens the
run (GitHub app or github.com → *Actions* → the run → *Review deployments*),
ticks `publication` and approves (*Approve and deploy*). Nothing has been
published before that click.

```bash
gh run watch $(gh run list --workflow=release-publish.yml --limit 1 --json databaseId -q '.[0].databaseId')
```

Order inside the run: npm (both packages), PyPI, MCP Registry (it validates
that the npm version exists), the manual-refresh checklist, the npm provenance
check; then the `release` job tags the commit (on a dispatch) and creates the
GitHub release. A failure anywhere stops the run before the tag.

## Step 3 — verify all four

```bash
npm view ibanforge-mcp version
npm view @ibanforge/sdk version
npm view ibanforge-mcp@X.Y.Z dist.attestations.provenance   # must not be empty
npm view @ibanforge/sdk@X.Y.Z dist.attestations.provenance  # must not be empty
curl -s https://pypi.org/pypi/ibanforge/json | python3 -c 'import sys,json;print(json.load(sys.stdin)["info"]["version"])'
curl -s 'https://registry.modelcontextprotocol.io/v0/servers?search=io.github.cammac-creator/ibanforge' \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(next((s["server"]["version"] for s in d.get("servers",[]) if s.get("_meta",{}).get("io.modelcontextprotocol.registry/official",{}).get("isLatest")),"?"))'
```

All four should print `X.Y.Z`, and both provenance lines a `predicateType`.

## Step 4 — manual-refresh platforms (no publish API)

The release run's summary lists them: MCP.so, RapidAPI, DevHunt, Glama,
Coinbase Bazaar. Most re-scan from npm within 24–48h; refresh by hand if needed.

Smithery: relay closure announced for 2026-10-31; no longer a publishing step
([announcement](https://smithery.ai/future)).

## What is pinned, and who moves it

- **Actions**: each `uses:` of the four publishing workflows and of
  `deploy-site.yml` names a commit, with its release in a comment on the same
  line. Dependabot's `github-actions` entry moves both, monthly, in one grouped
  pull request. To pin by hand: `gh api repos/<owner>/<action>/git/ref/tags/<tag>`;
  if the object is a `tag`, `gh api repos/<owner>/<action>/git/tags/<sha>` gives
  the commit. `scripts/workflow-hardening.test.ts` refuses a tag, `@latest` or a
  missing version comment.
- **npm** `12.2.2` (in `release-publish.yml` and `n8n-publish.yml`): the version
  that published 1.10.0. Needs Node `^22.22.2` and is at least 11.5.1 (trusted
  publishing). Bumped by hand, in both files.
- **build** `1.6.1` and **twine** `7.0.0` (`release-publish.yml`), installed as
  wheels only. Bumped by hand.
- **mcp-publisher** `v1.8.1` and its SHA-256 (`release-publish.yml`; how to bump
  is in the file).
- **n8n**: `integrations/n8n/package-lock.json` is tracked and installed with
  `npm ci --ignore-scripts`; Dependabot updates it.

## Troubleshooting

- **No "Waiting for review", the publication just went out** — the environment
  `publication` did not exist and GitHub created it empty. Check
  `gh api repos/cammac-creator/ibanforge/environments/publication --jq '.protection_rules'`
  and apply the settings above at once.
- **"… is not allowed to deploy to publication due to environment protection
  rules"** — the run was dispatched from another branch, or the tag does not
  match its pattern. Dispatch from `main`.
- **`ENEEDAUTH`, `E404` or `E403` on `npm publish` in CI** — the trusted
  publisher on npmjs.com does not match the job: workflow filename, repository,
  or environment (`publication`, step 0a). The run stops there, before PyPI, the
  MCP Registry and the tag; fix the publisher, then re-run.
- **"has no npm provenance attestation"** — the version on npm did not come out
  of this workflow (published by hand). Investigate before tagging anything.
- **MCP Registry: `NPM package 'ibanforge-mcp' not found (404)`** — npm did not
  publish the version first. Fix npm, then re-run the workflow.
- **`mcp-publisher: command not found`** — the old install script 404s; the
  workflow now downloads the release binary. If it breaks again, check the
  latest asset name at github.com/modelcontextprotocol/registry/releases.
