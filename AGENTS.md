# Working on IBANforge

Instructions for any coding agent opening this repository. Codex reads this file;
Claude Code reads `CLAUDE.md` next to it. **The two must say the same thing** — if you
change a rule here, change it there.

**`docs/handover.md` is the long version**: why each rule below exists, how the bank-code
verdict works, what a green test suite does not prove, the traps already paid for, the work
in flight and the known debts. Read this file first, that one before your first commit.

IBANforge is an IBAN validation and BIC lookup API. Three areas live in one repository:

| Area | Path | Runs on | Deployed by |
|---|---|---|---|
| The API (Hono, TypeScript, SQLite) | `src/`, `scripts/`, `data/` | Node 22 | Railway, on every push to `main` |
| The website and dashboard (Next.js) | `frontend/` | Node 24 | Vercel today, an Infomaniak VPS soon (see below) |
| The published packages | `mcp/`, `sdks/`, `integrations/` | Node 20 | a tagged release workflow, never by hand |

---

## The rules that are not negotiable

**1. Never push to `main`.** A push to `main` deploys the API to production. There is no
staging. Work on a branch, open a pull request, let CI go green, and let a human merge.
`main` carries no branch protection: the rule is the protection.

**2. This repository is public.** Never write a customer's or prospect's name, a real
e-mail address, or a real activity figure (accounts, calls served, revenue, reply rates)
into code, comments, test fixtures, documentation or commit messages. A pushed commit
message cannot be rewritten. Invented fixtures only: `acme@example.com`, `Société Alpha`,
`alpha.example.net`. Public bank names and public bank codes are data, and are fine.
The reasoning stays, the quantity goes: "measured on the real mailbox, N of M were bots"
becomes "close to a third were automation".

**3. One Node version per area.** Node 22 at the root: `better-sqlite3` ships no linux-x64
prebuild for the ABI of Node 24, so 24 breaks the production image. Node 24 under
`frontend/`. Node 20 for `mcp/` and `sdks/typescript/`. CI runs each in its own job.

**4. `npm run check` before every commit** (typecheck, prettier, lint, tests, runtime
dependency check). Frontend tests run **from** `frontend/`: at the root, vitest finds
nothing and exits zero, which reads like success.

**5. Prettier on `src/**/*.ts` is a CI gate.** Run `npx prettier --write` on every file you
create under `src/` or `scripts/`. Do **not** run it across `frontend/`: that tree does not
follow the root config and a blanket `--write` reformats hundreds of lines you did not
write.

**6. Do not regenerate `data/bic.sqlite`** unless your task is exactly that. It is a
tracked 35 MB binary; two branches that both reseed it produce a conflict that cannot be
merged. Same for `package-lock.json`: never commit a rewrite that changes no dependency.

**7. Never deploy, publish, or touch infrastructure.** No `vercel`, no `railway`, no
`npm publish`, no `gh release`, no DNS. Releases follow `RELEASING.md` and are run by a
human. Never print a secret; the repository holds none, and none should ever enter it.
Vercel does not build `codex/**` branches (`frontend/vercel.json`, 26.09.2026, to cut build
costs): your pull request gets no preview deployment. Check the site locally (`next build`,
`next start`); what goes online is proven after publication.

**8. No `Intl`, `toLocaleString` or `toLocaleDateString` in a client component.** WebKit
formats differently from Node, React blows up on the hydration mismatch and wipes the
class on `<html>`. Format through the helpers in `frontend/lib/`.

**9. Absolute paths in shell commands.** Never `cd somewhere && grep -rn foo src/`. The
permission guard cannot tell where a relative path points and stops to ask a human who is
not watching.

**10. Leave other people's work alone.** Several agents and sessions share this repository.
Branches, worktrees under `.claude/`, and stashes belong to whoever made them. `git fetch`
before every push. If you break `main`, fix it or revert it immediately.

---

## Commands

```bash
npm ci                    # root deps (Node 22)
npm run check             # typecheck + prettier + lint + tests + runtime deps — the gate
npm run test              # vitest, tests live next to the source as *.test.ts
npm run dev               # API on :3000
npm run openapi:lint      # the contract

cd frontend && npm ci     # site deps (Node 24)
npx vitest run            # site tests, FROM frontend/
npx tsc --noEmit          # site typecheck
npm run build             # next build
```

---

## Where things live

- `src/lib/enrich.ts` — the verdict on a bank code. `NATIONAL_REGISTERS` means *a miss
  proves non-existence*; `NON_EXHAUSTIVE_REGISTERS` means *a hit names the holder and a
  miss says nothing*. Putting a partial register in the first map is the trap this codebase
  has already fallen into once: `decideBankCode` reads `const registerDown = !!national`,
  so every miss would answer "we could not consult the register" about a register that
  answered.
- `src/lib/national-registers.ts`, `scripts/seed-national.ts` — the registers and their
  loaders. Each carries its source string and its `as_of`, and some carry licence
  conditions that must appear on every response built from them.
- `src/lib/trial.ts` — the keyless trial, in figures and in words. Every surface quotes
  these constants; none of them hardcodes the number. **The 25s never share a
  sentence.** The keyless trial is 25 validations a week (ISO week, UTC), on
  `POST /v1/iban/validate` only. The keyless access of the hosted `/mcp` transport is a
  separate allowance, `MCP_WEEKLY_LIMIT` in `src/lib/mcp-limits.ts`: 25 tool units a week per
  source address, a batch counting one per IBAN. The key that needs no e-mail is 25 requests a
  month, on every endpoint. Name the door, and announce the key by its 200 once claimed;
  `src/routes/free-doors-claims.test.ts` holds it. The npm package `ibanforge-mcp` quotes none
  of these figures: it is frozen until its next release, so it points to `rate-limits.yml` and
  `GET /v1` (`mcp/src/published-text.test.ts`).
- `src/middleware/x402.ts` — prices. `frontend/data/` — what the site pre-renders,
  exported from the API by `npm run pages:export` and `pages:export-countries`.
- `docs/data-sources.md` — every data source, its licence, and the permission we hold in
  writing. **Read it before touching a register.** Some sources impose an exact credit line
  and a notice that must be reproduced in full on every response.
- `src/lib/restricted-family.ts` — the data we may serve but not redistribute (EBA STEP2,
  NBP and OeNB directory rows, the AT, BE and SM registers, the PRA list, the UN list, both
  EPC registers), listed ONCE, with each table's definition and how its rows are dated. In
  production it comes from a private file per database, named by
  `RESTRICTED_BIC_OVERLAY_PATH` and `RESTRICTED_COMPLIANCE_OVERLAY_PATH` (absolute paths on
  the Railway volume, `/app/data/…`), merged at start-up into a copy of the fresh public
  database (`src/lib/restricted-overlay.ts`, `restricted-overlay-runtime.ts`), member by
  member, the fresher data winning: the public rows are kept (`kept_public`) when they are
  newer, or undated and different. The last accepted file is kept beside the private one
  (`*.accepted.sqlite`) and served at start-up if the file named by the variable is refused
  or lacks a member it serves (a late member absent included), even when that file gains
  another; such a file never replaces it.
  To reload, replace the file atomically (write a neighbour, then `mv`): the API checks it
  within ten minutes, rebuilds only that database, and keeps what it serves if the new file
  fails its checks or would drop a member served today. State: `GET /health` →
  `restricted_overlays`. Build a file with `npm run overlay -- extract` (no download) or
  `npm run overlay:seed` (private refresh only). To withdraw: remove the variable, restart,
  check `off`, then delete `restricted-*.merged-*`, `restricted-*.accepted.sqlite` and the
  overlay in the old folder; deleting the private file alone is NOT a rollback. **Never**
  commit an overlay file or a merged copy, never write one inside any git repository (the
  script refuses, and `.gitignore` catches `restricted-*.sqlite*` and `*.merged-*.sqlite*`),
  never add a table or a source to the family anywhere but that constant, and never let a
  public workflow download or commit the family. Since the removal (step 6, 25 September
  2026) none of it is in this repository: the public seeders run without `SEED_FAMILY`
  (public mode; the variable only accepts `restricted`) and never download a member, the tracked databases are rebuilt without it
  (`npm run overlay -- strip`, no download) and `src/lib/public-base-family-free.test.ts`
  fails if a row comes back, the composite map no longer carries the AT, BE, LU, PL and FI
  keys (the PL, FI and LU keys and the Finnish list come back from the overlay: members
  `map_pl`, `map_fi`, `map_lu` and `register_fi`, `mayBeAbsent`, rebuilt by
  `scripts/seed-curated-map.ts`; `/health` lists under `restricted_overlays.bic.absent`
  those the served overlay lacks), and the /at, /be and /sm pages read the API on demand. Without the overlay, every answer that needs the family says "not
  consulted" (`national_register_unavailable`, `screened: false`, `*_unavailable` flags),
  never "no".
- `src/lib/restricted-overlay-pull.ts`: the API refreshes those files itself (step 5,
  since 25 September 2026). A private repository rebuilds the overlay weekly (compliance)
  and monthly (BIC), commits no data, and publishes a release: both files and a
  `manifest.json` (`src/lib/restricted-overlay-manifest.ts`: SHA-256, size, generation
  date, public commit, rows per member), after a quality gate (`npm run overlay -- check`,
  then `manifest --previous`: no file or member lost, no member down more than 10%). One
  source down at the monthly run no longer stops it: each family seeder reports each
  member (`scripts/seed-report.ts`), and a member whose source failed is carried over as is
  from the previous overlay placed at the output path, original dates kept
  (`scripts/restricted-carry-over.ts`), recorded in the file and the manifest
  (`carried_over`) and announced by a `::warning::` annotation; refused when no member
  refreshed, without a previous overlay, or when a carried-over row is older than 45 days
  or of unknown date, or its PRA list falls outside the seeder's window. With
  `RESTRICTED_OVERLAY_PULL_REPO` (owner/name, written nowhere in this repository) and
  `RESTRICTED_OVERLAY_PULL_TOKEN` (fine-grained, read-only Contents on that repository
  alone), the ten-minute watcher pulls the latest release every four hours plus up to
  thirty minutes of jitter (one hour after a failure, never at start-up); a file whose
  hash is already served, in place or accepted is never downloaded again; otherwise the
  download is capped, its hash checked, `inspectOverlay` must accept every member and none
  served today may be missing (`members_lost`), a
  neighbour is written then renamed onto the file named by `RESTRICTED_*_OVERLAY_PATH`, and
  that database is reloaded at once. Any failure keeps what is served. Both variables
  unset: no network call, no alert, `GET /health` → `restricted_overlays.pull` is `off`;
  otherwise it gives the state, the last attempt and success, the latest release, and for
  each database the release and generation date of the served file, never the repository
  name nor the token. Alerts, closed on their own: `overlay:pull` (no successful pull for
  24 h), `overlay:pull:stale` (latest release older than 9 days, or a file older than 9 days
  for compliance, 35 for BIC, or missing). To withdraw: remove both pull variables first,
  then withdraw the overlay as above.
---

## Work in progress, at 10 September 2026

**The Greek register (HEBIC).** Branches `registre-gr-api` and `registre-gr-site`, local
only, not pushed. The Hellenic Bank Association granted commercial reuse in writing on
8 September under two conditions: the exact credit line, and its disclaimer reproduced in
full on every response carrying HEBIC data. The branches currently treat Greece as an
*authoritative* register, and that is wrong: the association's file lists credit
institutions, not the whole code allocation, so a real payment institution's code would be
answered "not allocated". The switch to `NON_EXHAUSTIVE_REGISTERS` is decided and being
applied on `registre-gr-fix`. Do not start over.

**Moving the website off Vercel to an Infomaniak VPS in Geneva.** Branch `vps-migration`
holds the first commit: a container image for `frontend/`, a deploy workflow that builds on
GitHub and ships to the VPS over a restricted SSH key, and the legal texts updated
(Infomaniak replaces Vercel as sub-processor). The API does not move. Remaining: two DNS
records, a decision on a CDN in front, and the cutover. The reasoning is in the internal
report named below.

**The keyless trial is twenty-five calls a WEEK since 24 September** (Claude-Alain's
decision; it was twenty-five a day from 15 September). `REST_TRIAL_WEEKLY_LIMIT` in
`src/lib/trial.ts` reads 25, counted per source address (IPv6 per /64) and per ISO week in
UTC, reset on Monday 00:00 UTC, in the table `trial_weekly` of the service database. The
daily rows of `trial_ledger` are still written and still feed `trial_daily`. Since the
evening of the same day, the keyless MCP tool calls are counted by the week as well, in a
bucket of their own in the same table (`MCP_WEEKLY_LIMIT` in `src/lib/mcp-limits.ts`); the
two allowances never share. Only the ceiling on MCP session openings
(`MCP_SESSIONS_PER_IP_DAY`) stays daily. No e-mail and no key are required for those calls. The key that needs
no e-mail is another door, announced by its 200 requests a month once claimed. Every surface
that quotes a figure is meant to read the constants; `src/lib/trial-figures-static.test.ts`
refuses the trial's figure beside a day, refuses any MCP line still counted by the day, and
checks every weekly figure written by hand.

---

## Internal reports and the roadmap

`docs/internal/` is **ignored by git and never published**: it holds traffic and revenue
reality, correspondence, and prospect files. Nothing from it may be quoted in a commit, in
code, or in a public document.

Two conventions live there and matter to any agent:

- **One roadmap, one address.** `docs/internal/pages/feuille-de-route-2026-09-06.html` is
  the single roadmap. It is generated from
  `docs/internal/feuille-de-route/feuille-de-route-gen.py`: change a line in the lists,
  regenerate, keep the same filename. Never create a second roadmap beside it. Superseded
  documents carry an archive banner pointing back to it.
- **Every chantier gets its report.** A study, an audit or a decision produces one
  self-contained HTML page in `docs/internal/pages/`, named `<sujet>-<date>.html`, served
  locally. The roadmap lists them all. If you deliver a study, deliver its page.

---

## Who does what

The main Claude Code session integrates, deploys, and owns anything touching production
data, the registers, and the deployment chain. A second agent is welcome on isolated
chantiers and on reviewing pull requests. Two agents editing the same files at once is the
one failure mode this repository has already paid for: say which files you are taking
before you take them.

`frontend/AGENTS.md` is written and re-added automatically by `next dev`. Leave it there.

---

## Handing a pull request to the integrator (since 15 September 2026)

The main Claude Code session integrates automatically: a watcher on the integrator's Mac polls
this repository every five minutes (no terminal needed, no tokens spent while nothing is ready)
and starts an integration pass as soon as a pull request is ready; the pass takes each ready pull
request in turn, reads the diff,
merges it into `main` with the local checks (including `next build`, which CI does not run),
watches the deployment, proves the change online, records a milestone on the private roadmap and
tells Claude-Alain. Nothing is asked of him unless a rule says it is his decision.

What makes a pull request *ready*:

- branch named `codex/<subject>-<yyyymmdd>`, base `main`, **not a draft**, all GitHub checks green;
- a description in French that says what changed, what was tested (root check, frontend tests,
  `next build`, browser checks) and, if the site is touched, **one thing to verify online after
  publication** — a new sentence, a file with a content hash, a JSON field — that only exists after
  the change;
- the private folder `docs/internal/<subject>-<yyyy-mm-dd>/` with `PASSATION.md` and, when a
  roadmap milestone is expected, `ETAPE-PROPOSEE.json` (`titre`, `statut`, `resume`, `rapport`,
  `url_locale`, `version`, `integration`). The integrator registers it and stamps it
  `enregistre_le`.

What the integrator answers with:

| Label | Meaning | What to do |
|---|---|---|
| `integrateur:en-cours` | being merged, tested and published | nothing; do not push to that branch until the label goes |
| `integrateur:a-corriger` | a public comment names what must change | push the fix on the same branch; the label is lifted automatically on the next pass |
| `integrateur:attente-claude-alain` | prices, quotas, registers, legal texts, infrastructure: his decision | wait; he removes the label |

The integrator never merges Dependabot, `vps-migration` or `registre-gr-*` branches: those belong
to other circuits or other sessions. It never publishes a package: releases follow `RELEASING.md`.

The mechanics live in `docs/internal/integration/integrateur.py` (private, on the Mac) and the
judgement in the skill `/ibanforge-integrer` of the main Claude Code session.
