# Handover — what this repository actually is

Written 10 September 2026, from a full read of the code, the delivery chain, the data
sources and four months of project memory. `AGENTS.md` at the root is the contract: ten
rules, the commands, the work in flight. **If this document and `AGENTS.md` disagree,
`AGENTS.md` wins.** This one explains *why* the rules exist and where the ground is soft.

Everything here is verifiable from a clone. Business figures, customer facts and internal
correspondence are deliberately absent: the repository is public, and `docs/internal/` —
which holds them — is gitignored and never published.

---

## 1. Three things that surprise everyone

**The IBAN parsing is not in this repository.** `src/lib/iban.ts` is a twenty-five line
adapter. Mod-97, the per-country length table, the BBAN split and the BIC format check
live in an npm package consumed under the alias `iban-core` (`package.json`, aliased
because this repository is itself called `ibanforge` and a bare import would resolve to
its own build). The local safety net is `src/lib/iban-core-contract.test.ts`, which
imports through the product's own façades so a broken re-export fails too. The dependency
is pinned to an exact version on purpose: a stray `npm install` must not be able to swap
the validation rules under production.

**The order of `src/app.ts` is the business model.** Middlewares are mounted in an order
where swapping two lines would mint free credit bundles with a fully green suite. The file
says so at the top, `buildApp()` is exported so the assembly can be tested rather than
assumed, and `src/app.test.ts` pins it with 28 cases. Read that file's header before
touching anything in it.

**A miss can be a lie.** The whole product turns on one distinction, described in section
3. Getting it wrong does not produce an error; it produces a confident wrong answer to a
payment engine.

---

## 2. The architecture, in one page

| Zone | Path | Node | Deployed by |
|---|---|---|---|
| The API — Hono, TypeScript, SQLite | `src/`, `scripts/`, `data/` | 22 | Railway, on every push to `main` |
| The site and operator dashboard — Next.js | `frontend/` | 24 | Vercel today; a Swiss VPS is in flight |
| The published packages | `mcp/`, `sdks/`, `integrations/` | 20 | tag-triggered workflows |

Node 22 at the root is not caution: `better-sqlite3` publishes no linux-x64 prebuild for
the ABI of Node 24, and the slim image has no compiler, so the production image would not
build. Node 24 under `frontend/` is not a preference either — that lockfile is the one
where npm 10 and npm 11 resolve different trees, and pinning the runner is what stopped a
month of red CI.

**Three SQLite databases.** `data/bic.sqlite` (reference data, opened read-only at
runtime, rebuilt monthly, tracked in git) · `data/compliance.sqlite` (sanctions, SEPA and
VoP registries, read-only, tracked) · `data/stats.sqlite` (keys, quotas, credits, request
log, the whole CRM — the only writable one, gitignored, created and migrated by the
application itself at boot, living on a Railway volume).

Do not regenerate the two tracked databases unless that is exactly the task. They are
binaries; two branches that both reseed one produce a conflict that cannot be merged.

**The runtime surface.** Paid routes go through x402 (USDC on Base) or an API key or
prepaid credits: single validation, batch, BIC lookup, compliance, Swiss clearing, UK firm
lookup, and the credit bundles themselves. Free routes: format check, IBAN structure,
payment-reference check, postal address check, Swiss QR-bill check, demo, test-IBAN
generation, and all key management. Beyond `/v1`, everything is free: landing page,
health, `llms.txt`, the OpenAPI contract, the agent-discovery files under `/.well-known/`,
and the MCP endpoints. Two separate admin doors exist and must not be confused: a bearer
token for statistics, and a distinct secret for the `/v1/admin/*` surface.

---

## 3. The verdict on a bank code — read this before touching `enrich.ts`

`bank_code_check` answers one question: *does this bank code exist, and who holds it?*
Three statuses, six reasons, both closed enumerations in `src/lib/bank-code-schema.ts`.

Two maps in `src/lib/enrich.ts` decide the weight of the answer:

- **`NATIONAL_REGISTERS`** means *a miss proves non-existence*. A code absent from one of
  these answers `not_in_register` / `not_allocated` with `authoritative: true` — which a
  payment engine reads as "do not send". Adding a country here is a claim, not a coverage
  improvement.
- **`NON_EXHAUSTIVE_REGISTERS`** means *a hit names the holder, a miss says nothing*. A hit
  answers `verified` with `authoritative: false`; a miss falls through untouched to
  whatever the country received before the register existed.

**The trap.** `decideBankCode` computes `const registerDown = !!national` from the first
map. So putting a partial register in `NATIONAL_REGISTERS` breaks two things at once: a
miss becomes "this code does not exist", *and* every miss reports "we could not consult the
register" about a register that answered. The second is the subtler lie — it describes us
as broken instead of describing the beneficiary as dead. The code fell into this once and
the docstring records it; San Marino was caught on the way in.

Related invariants:

- **A failed lookup is never dressed as a refusal.** `checkBankCode` wraps the decision and
  turns any throw into `unavailable` / `lookup_failed`. Its docstring is the best page of
  doctrine in the repository. Meanwhile `lookupNationalCode` is deliberately written
  *without* a catch: a `catch { return null }` there once produced confident
  `not_allocated` verdicts on real banks from a schema drift.
- **A retired code was allocated.** Answering "not in register" for a merged bank would be
  a bigger lie than answering `verified` with a qualification, so retirement and successor
  travel with the answer.
- **A bank code can be variable length.** One country allocates prefixes of one to four
  digits; slicing a fixed three would read the largest bank's `1` as `123` and deny it.
  Resolution is by longest allocated prefix over the whole BBAN.
- **A code map derived from BIC prefixes is circular.** One country's map turned out to be,
  every row of it, the first four letters of its own BIC — so a fabricated IBAN came back
  `verified` naming a corporate treasury as a bank. Hence `issuer.iban_issuer`, and a type
  we cannot support becomes `null` rather than defaulting to `bank`.

---

## 4. Invariants worth knowing before the first commit

Each one is a failure already paid for. The code marks them with 🚨; the tests that hold
them are named beside each.

| Invariant | Held by |
|---|---|
| Middleware order — a paid route must not be reachable before the paywall | `src/app.test.ts` |
| Format guards mount *after* x402, so a bare crawler GET gets 402 (the invitation to pay) and not 400 (which reads as "broken") | `src/app.test.ts` |
| A POST with an empty body keeps its 402 — that is how x402 catalogues probe us | `src/app.test.ts` |
| A presented key, even a broken one, never falls back into the anonymous trial | `src/app.test.ts` |
| x402 must not fail open: production refuses to start without a wallet, unless free mode is explicitly on | boot check in `src/index.ts` |
| A 402 must never dress a facilitator outage — the honest answer is 5xx | `src/app.test.ts` |
| No submitted identifier is ever persisted: query values and path secrets are redacted from logs | request logger in `src/app.ts` |
| Quota is published only after the refund; 4xx refunds, 5xx does not, so an outage cannot hide | `src/middleware/api-key.ts` |
| The batch quote and the batch handler must read the body the same way | `src/middleware/x402.ts` |
| Never hardcode a dataset size — read it live | `src/lib/dataset-facts.ts` |
| A number travels with the code that applies it (the keyless trial constants are a leaf module for this reason) | `src/lib/trial.ts` |
| Every field an MCP handler can emit must be named in the output schema, or the SDK silently strips it | `scripts/mcp-parity.test.ts` |
| One version number across all release files | `scripts/version-lock.test.ts` |
| Any enum value quoted in the docs must exist in the code that emits it | `src/lib/docs-enums.test.ts` |
| Every example e-mail published anywhere is driven through the real signup route | `src/routes/example-emails.test.ts` |
| Every private frontend route answers 401 without a session — routes are discovered by glob, so a new one is enrolled the day it lands | `frontend/app/api/private-routes-auth.test.ts` |
| The three message catalogues have identical keys and identical interpolations | `frontend/lib/messages-parity.test.ts` |
| The Stripe account also carries another project's payments: the dashboard headline "Collected" counts packs + subscriptions + audits only, never `autre`; net, payouts and balance are account-wide because Stripe does not split them by product. A subscription renewal is recorded once, from `invoice.paid` with `billing_reason = subscription_cycle` — never the first invoice, whose amount already sits on the key | `src/lib/stripe-revenue.test.ts`, `src/routes/stripe-webhook.invoice.test.ts`, `frontend/lib/dashboard/stripe-revenue.test.ts` |
| The customer account (`/v1/account/*`, page `/account`) never reads `api_keys` on `code` or `session`, so it cannot tell whether an address has keys; one `invalid_code` for every unusable code; the `ifs_` session token lives only in an `HttpOnly; SameSite=Strict` cookie scoped to `/v1/account`, stored hashed, and is never accepted as an API key. Its two tables are outside the backup and must stay covered by `scripts/forget-customer.cjs` | `src/routes/account.*.test.ts`, `src/lib/account.*.test.ts`, `scripts/forget-customer.account.test.ts` |

**Three runtime ledgers live in memory, per instance**: the keyless trial, MCP sessions,
and the rate limiter. The API therefore cannot run multiple instances without
externalising them. That is an architectural ceiling, not a bug — know it before promising
horizontal scaling.

---

## 5. Data, sources and the obligations they carry

`docs/data-sources.md` is the authority: every source, what it gives, under which licence
or written permission, with the sentence quoted and the date it was read. **Read it before
touching any register.** Four rules distilled from it:

1. **Look for the licence closest to the data** — the file, its technical sheet, its
   download page — before the site's general terms. They routinely disagree, in both
   directions. An assumed licence is worse than an unknown one: it stops anyone checking.
2. **Some sources impose an exact credit line and a notice to reproduce in full on every
   response built from their data.** That is a permission condition, not a freshness nicety:
   a credit that rots is a breach. The pattern to copy is the guard test that fails when
   the month shown differs from the month loaded (`src/routes/pra-attribution.test.ts`).
3. **Un refus ferme complètement une source** : aucune de ses données ne doit entrer dans
   le dépôt ou l'API. AusPayNet a explicitement refusé la réutilisation proposée de son CSV
   BSB ; la restriction datée figure dans `docs/data-sources.md`.
4. **A register's own robots file is respected as policy.** One central bank names our
   crawler; that is not something to "fix" with a user-agent rotation.

**Un registre qui fait foi se relit plus souvent que le mensuel.** Depuis le 25.09.2026, le
registre tchèque (ČNB) est relu chaque jour par `.github/workflows/refresh-cz-register.yml` :
la ČNB publie ses éditions à l'avance et pas toujours le 1er, et un code absent y vaut refus.
Ce workflow peut donc pousser `data/bic.sqlite` sur `main` n'importe quel jour (seulement quand
le contenu tchèque change) : `git fetch` et rebase avant chaque push, comme toujours. Il
partage le groupe de concurrence `bic-sqlite-writer` avec `refresh-bic.yml`. Un échec de
lecture garde l'édition en place et fait passer le run au rouge avec une alerte Telegram.
La bascule vers une édition annoncée se fait à la requête, à minuit heure de Prague
(`activeTable()`, `src/lib/national-registers.ts`). Un prochain registre à publication non
mensuelle suit le même modèle.

Known gaps a newcomer should expect to work on, in order:

- **The `NOTICE` file requires a verbatim attribution sentence for the BIC-to-LEI mapping
  table, and no served surface carries it.** Add it to the surfaces that expose that data
  and pin it with a guard test. While you are there, `NOTICE` itself describes the
  sanctions sources inaccurately.
- **Two countries are served as authoritative registers without their terms ever having
  been read**, and neither appears in `docs/data-sources.md`. Authoritative means a miss
  says "do not send". Instruct the licences or downgrade the claim.
- **Several served datasets have no licence entry at all**, including the composite bank
  code map that answers for most of the world. Their provenance is only visible in a build
  script header.
- **The figures in `docs/data-sources.md` have drifted from the databases.** Recount before
  quoting.

---

## 6. The delivery chain, and what it does not protect

**A push to `main` deploys the API to production.** Railway builds and swaps the container
without consulting CI; measured, the new container is live about forty seconds after the
push. There is no staging. On a service with a volume the previous container is stopped
first, so a container that fails to boot is an outage, not a non-event — that happened once
for thirteen minutes, from a devDependency imported at runtime and therefore absent under
`npm ci --omit=dev`. The guard added since is `scripts/check-runtime-deps.ts`, plus a CI
job that builds the production image and boots it.

**`main` carries no branch protection.** The rule "never push to `main`" is the protection.
A branch protection rule requiring the CI context is the single highest-value change
available on this repository, and it takes two minutes.

**Two scheduled workflows commit to `main`**, and therefore deploy: the monthly reference
data rebuild and the weekly compliance refresh. Both have quality gates that have caught
real problems. The gates guard the *data*, not the *deployment*.

**The site's domains are pinned by alias.** Vercel's production deployment updates itself,
but `vercel alias set` pins a domain to a specific deployment and that pinning overrides
production tracking — the workaround became the cause and re-arms every time it is applied.
After a build, both the apex and the `www` domain need the alias, and removing the last
pin has dropped both. `vercel --prod` must run from the repository root, never from
`frontend/`, because the project's root directory setting adds to the working directory.
And no preview deployment can ever serve the dashboard: the preview environment has
neither session nor admin secret, by design.

**Releases are four independent tag namespaces**, not one gesture: the main tag publishes
two npm packages, PyPI, the MCP registry and the GitHub release; separate tags publish the
Java, .NET and n8n artefacts, each with its own version line. `RELEASING.md` lists the
files that must carry the same number. Two traps: the main release workflow marks its npm
steps `continue-on-error`, so it **can succeed while publishing nothing**; and no published
npm version currently carries a provenance attestation, which means none of them came out
of a workflow. Checking and, if needed, registering trusted publishers is the fix — not
publishing by hand again.

Measured on 15 September 2026, releasing 1.6.0: the documented order works and is the only
one that does. `npm publish --access public` by hand from `mcp/` and from `sdks/typescript/`
(the granular token in the operator's `~/.npmrc`), **then** `gh workflow run
release-publish.yml --ref main -f version=1.6.0`, which uploaded PyPI, published the MCP
Registry (it validates that the npm version exists first), created the tag at the commit it
checked out and the GitHub release. The trusted publisher is still not registered on
npmjs.com, so the two npm steps of the workflow still end in "already on npm — skipping".
One command that does not do what it looks like: `npm --prefix <dir> publish` publishes the
package of the **current** directory, not `<dir>`.

**Pull requests from Codex are integrated by a loop, not by hand (since 15 September 2026).**
The main Claude Code session polls the repository every fifteen to twenty minutes while its
terminal is open. For each ready pull request on a `codex/` branch (not a draft, every GitHub
check green) it runs the mechanical controls (`docs/internal/integration/integrateur.py`, private:
forbidden files, lockfile rewrites, public-repository leaks, sensitive paths), reads the diff
itself, merges `--no-ff` into `main` in the main working tree, replays the local checks for the
areas touched — including `next build`, which CI does not run — and resets the tree if anything
is red. After the push it waits for the CI run of `main`, for the API container to restart and
answer `ok` on `/health`, for the Vercel deployment of that commit to be `READY` with both
domains, and for one piece of content that only exists after the change to be served. Only then
does it record the milestone, write the coordination sheet and notify. If the API stops
answering after a merge, it reverts the merge commit at once; if `main` goes red, it merges
nothing else until it is green again. Three labels carry the state: `integrateur:en-cours`,
`integrateur:a-corriger` (a public comment says what to fix; lifted automatically when a new
commit lands), `integrateur:attente-claude-alain` (prices, quotas, registers, legal texts,
infrastructure). What the loop expects from a pull request is in `AGENTS.md`, section "Handing a
pull request to the integrator". The loop merges nothing from Dependabot and publishes no
package.

---

## 7. What a green suite does not prove

The root suite is hermetic: no test reaches the network, the two tracked databases are
opened read-only so a write would throw, and a setup file gives every test file its own
empty stats database. That last part exists because Vitest 4 removed the option that used
to serialise the suite and **ignored it in silence**, after which three consecutive runs
failed on three different files, none reproducible alone.

Three ways a green run can mean nothing:

- **Roughly ninety-five cases are `skipIf`-ed on whether the reference data is actually
  seeded locally.** On an unseeded database whole families vanish, in green. Read the skip
  count, not the colour.
- **The root suite does not cover `mcp/`, `sdks/` or `frontend/`.** Each has its own CI job.
  Running vitest from the repository root while intending to test the site runs the API
  suite instead and reports thousands of passing tests, none of them the site's. Frontend
  tests run **from** `frontend/`.
- **No React component is tested and CI never runs `next build`.** The failure class this
  codebase knows best — a client component importing a module that pulls in the database
  driver — passes typecheck, passes lint, passes vitest, and only breaks at build. Adding
  `next build` to CI is the best-value gap on the frontend side.

---

## 8. Traps already paid for

**Server/client boundary (Next.js).** Never `Intl`, `toLocaleString` or
`toLocaleDateString` in a client component: WebKit formats differently from Node and
Chromium, React throws a hydration mismatch **in Safari only**, and its recovery re-renders
the root element and wipes the class the inline script had set — killing every rule keyed
on it. Format through strings (`frontend/lib/format-grouped.ts`), and for Swiss time
through `frontend/lib/crm/zurich.ts`, which writes the daylight-saving rule out by hand
for exactly this reason. Check in WebKit, not only in Chrome.

**`dynamicParams`.** Setting it to `false` on the locale layout cascades onto every
dynamic segment beneath it, and once made the entire long tail of register pages answer
404 in production while the sitemap listed them all. It is now explicitly `true`, with the
reason written next to it.

**Every stored timestamp is UTC.** The API records in UTC, the mail sync files the UTC
date, scheduled sends carry the UTC minute. Displayed raw to a Swiss reader, a scheduled
departure looks late, and a late automatic send looks like an outage. Store UTC, display
Swiss.

**Two timestamp formats coexist** in the writable database — SQLite's default with a space,
and full ISO from application inserts. Comparing one to the other silently matches nothing,
and a naive conversion produces an invalid date and a 500 in production with green local
tests.

**A WAL database never copies alone.** Reading only the `.db` gives the state of the last
checkpoint: valid, coherent, and stale, with no error. Copy all three files or query in
place.

**Parallel sessions share this repository.** Fetch before every push — except when local
`main` carries a merge commit, where `git pull --rebase` flattens the merge and reopens
resolved conflicts; use `git fetch` then `git merge --ff-only`. Never check out another
branch in the main working tree; use a worktree. In a worktree, `frontend/node_modules` must be a
**copy** (an APFS clone, `cp -Rc`, costs nothing), never a symlink: `next.config.ts` pins
Turbopack's root on `frontend/`, and `next build` refuses a link that points outside it
(`Symlink [project]/node_modules is invalid, it points out of the filesystem root`). A
symlink at the worktree root for the API's `node_modules` is fine. And `.gitignore` must say `node_modules`
without a trailing slash, or an agent's symlink gets committed and replaces the real
directory at merge time.

**A comment is a public surface.** Reasoning stays, quantity goes. This class has been
purged repeatedly and comes back through test fixtures and through directories the previous
sweep did not look at. A commit message cannot be rewritten once pushed, and the message
that *repairs* such a leak must not describe what it removed.

---

## 9. Work in flight

**The key tier data layer landed on 15 September (lot 2 of the no-e-mail key programme).**
`api_keys` now carries `tier` (`anonymous | email | claimed | paid`, default `email`, which is true
for every key born before the column), `claimed_at` and `claim_method` (the date and the door of a
PROOF — a verified 6-digit code or a qualifying payment — never set retroactively, because nobody can
know after the fact which historical key actually proved its mailbox), `email_norm` (the form on
which "one person, one free key" is measured: `+tag` dropped everywhere, dots dropped on gmail only),
`origin_prefix` (the lineage that survives `/rotate`) and `shield_episode`. Two append-only journals
the caller cannot erase: `key_claims` and `key_settlements`. Read
`src/lib/api-keys.ts` before touching any of it; four rules distilled from it:

1. **`generateApiKey` is the only place a free key is minted, and it writes its own
   `key_creations` row inside the same transaction.** Do not add a second `recordKeyCreation`
   call in a handler: the creation breaker counts those rows, and a doubled row arms it at half
   the real volume. Paid rails (`generateCreditKey`, `generateStripeKey`, `generateOemKey`) write
   none: a burst of purchases is not abuse.
2. **Rotation does NOT copy the birth row** — it carries `origin_prefix` instead, and moves
   `key_settlements` along with `api_usage`. A copy per `/rotate` (a public route with no cap)
   would let anyone arm the breaker at will; a settlement left behind would let a rotated key
   buy the promotion again.
3. **Every write that targets a key goes by `key_hash`, never by `key_prefix`.** The prefix had
   no uniqueness in the inherited database (a guarded unique index now exists, and the mint
   redraws on collision), and an `UPDATE` without `LIMIT` on a non-unique column promotes every
   row of that prefix.
4. **A migration block that backfills from later columns is placed after them.** The tier block
   sits after the `x402_payment_ref` migration on purpose: placed inside the earlier `keyCols`
   block it would throw `no such column` on a fresh database and the API would not boot.
   `src/lib/db-schema.test.ts` opens a fresh database, an April-shaped one and one with duplicate
   prefixes, and is the only test that catches a misplaced block.

The backup format moved to 2 with a READABLE range `[1, 2]`: bumping without a range would have
made every dump taken before this day unrestorable, on a database that has no other backup; not
bumping would have made a truncated dump indistinguishable from an old one. Restore order matters:
start the service once so the migration runs, then restore.

**The keyless trial moved into the database on 15 September (lot 4).** `trial_ledger` (one row per
UTC day and per source bucket) and `trial_daily` (the aggregate the breaker will calibrate on) replace
the in-memory counter that a redeploy used to reset. The bucket is `hashIp(normalizeIpForGuard(ip))`
— IPv6 collapsed to its /64 first, so one subscriber is one bucket, computed once in
`src/lib/ledger-bucket.ts` for both doors (REST and MCP). The allowance is `REST_TRIAL_DAILY_LIMIT`
(25) in `src/lib/trial.ts`; every published figure derives from it and
`src/lib/trial-figures-static.test.ts` caps the lines that still spell a number. What to know:
`countDailyUnits` short-circuits in memory once a bucket is over the limit (no write per refused
call), falls back to memory with `degraded: true` when the database refuses, and the hourly tick in
`src/index.ts` snapshots yesterday, sweeps the ledger and reviews its volume — in that order.
`effectiveTrialLimit()` in `src/middleware/anonymous-trial.ts` is the single hook for a stricter
limit under alert; it is deliberately not wired until the daily peak has been measured
(`GET /v1/admin/trial?days=14`, `peak_hour_buckets`). Proof of the port: a keyless call that answers
402 keeps answering 402 across a redeploy.

**Since 24 September the REST trial is counted by the WEEK** (Claude-Alain's decision: 25 a
day was too much). `REST_TRIAL_WEEKLY_LIMIT` (25) per source and per ISO week in UTC, reset on
Monday 00:00 UTC for everyone at once. The decision reads a table of its own, `trial_weekly`
(`week` = the Monday as `YYYY-MM-DD`, `bucket`, `units`), through `countWeeklyTrialUnits`,
which writes the `rest:<h>` row of the day in the same transaction. Why not sum the daily rows
since Monday: `snapshotTrialDay(yesterday)` runs every hour and only abstains on an EMPTY day,
so REST rows kept for a week would have made the tick after the first one overwrite
`mcp_buckets`, `init_buckets` and `rest_attempts_uncounted` with zeros every day; and a sum per
source on a `(day, bucket)` key scans the whole week. So `trial_ledger`, `trial_daily` and the
MCP daily ceilings behave exactly as before; `rest_over_limit` now reads "sources that spent
the whole week in one day". The `trial` block says `calls_used_this_week`,
`calls_left_this_week`, `weekly_limit`, `resets` and `resets_at`; the daily names were removed
(no published package read them). `X-Trial-Reset` is the ISO instant, `X-Trial-Period: week`.

**The same evening, the keyless MCP access moved to the week as well** (Claude-Alain's
decision). `MCP_WEEKLY_LIMIT` in `src/lib/mcp-limits.ts` (25; renamed from `MCP_DAILY_LIMIT` so
that no forgotten use keeps compiling under a daily name) is spent per source and per ISO week
in UTC through the same `trial_weekly` table, in a bucket of its own: the bare hash `<h>`,
beside the trial's `rest:<h>`. The two allowances never share. What stays REST-only filters on
the `rest:` prefix (`rest_attempts_uncounted`, the admin week total, which now shows
`mcp_this_week` beside it). The daily rows are still written for `trial_daily`; only the
ceiling on MCP session openings (`init:<h>`, `MCP_SESSIONS_PER_IP_DAY`) stays daily, because it
bounds container memory rather than a free offer. `GET /v1` serves `mcp_weekly_limit` and
`mcp_period`; `GET /mcp` adds `mcp_resets` and `mcp_resets_at`. The npm package
`ibanforge-mcp` writes none of these figures, nor their period: a published package stays
frozen until its next release, so its README and the instructions it serves point to
`rate-limits.yml` and `GET /v1`, and `mcp/src/published-text.test.ts` refuses a quota figure or
period in anything it serves.

**The cohort radar sees anonymous keys since 15 September (lot 6), in report mode.** A second pass
in `src/lib/cohort-radar-server.ts` loads anonymous and claimed keys with its OWN query (the e-mail
loader's `no_recredit = 0` and `monthly_limit IS NULL` clauses are false by construction for an
anonymous key — copying it would silently scan nothing), finds the global burst first
(`findBurst`: the longest uninterrupted run, never the first trigger), then groups by anchor
(User-Agent, or network when the UA is empty) within that burst only. It cuts nothing on its own:
`IBANFORGE_REVOCATION_ENABLED` is absent in production; `CLAIM_REPAIR_LANDED` in
`src/lib/tiers.ts` is `true` since the same day (lot 6b): `/v1/keys/claim` recognises a key cut for
a burst (`findBurstRevokedKey`, the one inactive key it accepts) and a successful claim restores it
and raises it in one transaction (`restoreBurstRevocation`) — so switching the flag on is the only
step left before automatic cuts, and it is a decision, not a deploy. Three rules
to keep: a cohort seen from fewer than `BREAKER_MIN_DISTINCT_SOURCES` (5) networks is never cut
automatically, so a single-IP farm — which is also what a corporate NAT looks like — is reported
and cut by hand (`POST /v1/admin/cohorts/cut`); a cut key answers 402 `key_revoked_burst` through the
x402 rail, never a bare 403, with the claim route named first; and every cut writes its previous
balance to `key_revocations` in the same transaction (`GET /v1/admin/key-revocations`, hash never
served). The breaker (lot 5) arms the radar through three bare `kv_state` strings —
`creation_breaker:armed`, `creation_breaker:armed_at`, `creation_breaker:episode_id` — plus
`cohort_scan_due`; it imports `BREAKER_MIN_DISTINCT_SOURCES` and `BREAKER_WINDOW_MINUTES` from
`src/lib/cohort-radar.ts` rather than redeclaring them. The backup format is 3 (readable `[1, 2, 3]`)
so that a dump taken before the journal existed stays distinguishable from a truncated one.

**The trial is measured per key lineage since 15 September (lot M).** `api_keys.lineage_hash` is the
`key_hash` of the key that was born; `rotateApiKey` copies it, so a lineage survives rotation, and
`lineage_facts` keeps ONE row per lineage with every "first" written once (`COALESCE`, so replaying a
fact changes nothing): first business 2xx and its canonical route, first call outside the demo panel,
second-week return, settlements, the paid key linked to the same holder when the match is
unambiguous. The recorder runs in the tracking middleware of `src/app.ts` after `recordRequest`, only
when a key was presented, only for the billable families (`isBillableCall`, matched on the
normalised route, never on a textual prefix), and costs one write per lineage, per context and per
UTC day; it never throws. The context comes from the request header `X-IBANforge-Context` (`demo`
from the site's first-call panel, anything else is `unknown` — never inferred as "production"); the
header is in the CORS allow-list, and removing it there silently breaks the panel at preflight.
`GET /v1/admin/funnel?since=YYYY-MM-DD&days=28` serves the six indicators of the measurement contract
with denominators restricted to lineages that have the required hindsight (`pending` otherwise) and
`null` instead of a percentage when the denominator is empty. Three limits are printed in the
response itself: MCP tool calls are not activations (they land under `/mcp`, outside the billable
families), `paid_key_delivered` is almost always 1 by construction, and rows reconstituted at
migration are flagged `backfilled = 1` and excluded from every denominator. The migration reads
`request_log` once, at the first boot after the deploy, under its own try/catch. Backup format 4.

**The whole first wave shipped on 15 September, then went through the adversarial review the
programme brief required (four lenses, one reflection-tier agent each).** What the review changed the
same day, and why it matters to whoever touches these modules next:

- **Verification codes are budgeted per (recipient, network) and per recipient domain**
  (`challengeSendAllowed` in `src/lib/key-creation-guard.ts`). Counted per recipient alone, the
  anti-mail-bombing cap was the weapon: three codes posted by a stranger to a victim's address locked
  that address out of any code for a day. The per-domain cap (public mailbox providers exempt) is
  also what bounds a catch-all domain: a farm that spends a domain name used to get the six-digit
  proof of mailbox for free and without limit, and that proof exempts a key from the breaker's shield,
  from both radar passes and from any cut. That yield existed before the programme; the review made
  it visible, the domain cap bounds it, and the two remaining levers (a global hourly cap on claims,
  a smaller per-network cap on anonymous creations) are decisions, not code.
- **The manual cut honours the diversity guard unless `force: true` is in the body**
  (`cutCohortNow`). The report and the alert invite the operator to paste an anchor into
  `POST /v1/admin/cohorts/cut`, and the anchor they paste is sometimes the one the automatic pass had
  just spared (`below_source_floor`): a lone newcomer under a generic User-Agent, or a whole corporate
  NAT. Cutting is now a written decision, never an omission.
- **The e-mail pass of the cohort radar loads on `tier = 'email'`, not on quota columns.** Its
  historical `no_recredit = 0 AND monthly_limit IS NULL` described "an ordinary free key" only as long
  as nothing else wrote those columns; the breaker's shield does, and the lift writes an explicit 200,
  so every key that had been through an alert left both passes for good, silently.
- **A long burst window (60 keys in 6 hours)** in `ANON_BURST_WINDOWS`: a farm that spaces one
  creation every three minutes never formed a 30-second burst and left the anonymous pass before any
  grouping, whatever its User-Agent.
- **`key_creations` is in the backup (format 6).** Without it a restored volume made every restored
  key invisible to the breaker and the radar, hence irrevocable: the one place where the single birth
  row invariant was silently undone.
- **The lineage measurement counts consecutive write failures and `lineage:blind` says so**; a
  database refusing writes used to produce a funnel full of zeros that nothing could tell from
  "nobody activates". `closeAll()` also resets the lineage day cache.
- The consent atoms no longer describe the second-wave rails (an MCP approval tool, a card checkout
  on the API) as existing: they say "planned, not available yet" and point at what exists (packs by
  card on the pricing page, in USDC through the API). An agent that reads a route which answers 404
  learns that the documentation lies.

What the review confirmed and left alone: a key already in service never falls to the radar (only a
key born inside the burst window can), rotation carries everything, a settlement is counted once, a
manual cut on a single-network cohort is possible only with `force`, and the breaker cannot be armed
"permanently" without renewing dozens of fresh networks a day — its bound and its automatic lift are
the right answers there.

**Dashboard numbers now render identically on both sides (#182, 11 September).** Five client
components — `status-by-path-table`, `live-health-strip`, `usage-chart`, `stacked-bar-chart` and
the CRM `freshness-badge` — used `toLocaleString`, `toLocaleDateString` or `Intl.DateTimeFormat`.
Node and WebKit ship different ICU data, so the server wrote `121 773` (narrow no-break space)
where Safari wrote `121'773`, and React reported a hydration mismatch (#418) on every dashboard
page, in French and German only. They now go through `frontend/lib/format-grouped.ts`,
`frontend/lib/crm/format.ts` and `frontend/lib/crm/zurich.ts`, which are pure and locale-explicit.
`frontend/lib/dashboard/number-rendering.test.ts` locks it: it stubs the native formatter to
return two *different* strings and asserts the rendered HTML is byte-identical, and it fails the
badge if `Intl.DateTimeFormat` is constructed at all. **The rule this encodes: a client component
never calls a native locale formatter.** Verified on the served site — the served dashboard
JavaScript contains zero `toLocale*` calls, against nine before.

**Observed business responses and returning days (#183, 11 September).** `src/lib/service-usage.ts`
adds a `service_usage` block, version 1, to the existing private route `/v1/admin/activation`.
No new endpoint, no new collection, no migration, no browser identifier. Read it before quoting
any of its three numbers:

- **The unit is an account that can be attributed, not a person, not a sale, not a visitor.** An
  account is a normalised e-mail gathering its retained keys, including keys deactivated by a
  rotation. A key prefix claimed by more than one account is dropped *before* internal and generic
  accounts are excluded, so a key shared between an internal and an external account is never
  credited to the external one.
- **A business response is a 2xx on a billable route**, reusing `buildBillableFilter` and excluding
  literal OpenAPI path parameters. A negative IBAN verdict returned with HTTP 200 counts: the
  measure is "the service answered", not "the answer was yes".
- **`first_observed_accounts` means the first business response still present in the retained
  traces**, not the first ever. A purge moves that date. Say "first observed", never "new".
- **`returning_accounts` is at least two distinct UTC days inside the window**, unioned across the
  account's keys. **Two dates are not a D+7 retention figure**, and the two subsets overlap — never
  add them together.
- The frontend guard `frontend/lib/dashboard/service-usage.ts` recomputes the expected window from
  `observed_until` and `period_days` and refuses the whole reading on any mismatch. **An older or
  incoherent API renders "unavailable", never three zeros.** Keep that property: a zero that is
  really an outage is the failure mode this card exists to avoid.
- Calls with no attributable key, generic accounts and the hosted MCP are out of scope, and no
  visit → account → purchase link is delivered by this lot.

Measured on the served API, not locally: 162–235 ms per read on both windows, twelve concurrent
reads all successful, and no failure under the full parallel load a dashboard render produces.

✅ **The dashboard's private blocks used to vanish together, and the cause was our own rate
limiter.** One dashboard render fires about fifteen private reads. Three renders inside the same
minute crossed the 100-requests-per-minute-per-IP ceiling, and every call after that came back
429, so all `ADMIN_SECRET`-fed blocks turned to "unavailable" at once. **The API's own logs showed
nothing**: that 429 leaves `rateLimitMiddleware` before any route can write to `request_log`, so
`/v1/admin/activation` showed zero 5xx, a 4 ms average and a motionless 401 counter while the
screen was visibly broken. Half a day was spent looking on the wrong side of the wire.

Fixed on 11 September: an authenticated private read is exempt from the per-IP limiter, because
rate-limiting a call that already carries its secret protects nothing — a caller without the
secret is stopped by the 401. **The exemption is conditioned on a VALID secret, never on the path
alone**, so an unauthenticated or wrong-secret caller is limited exactly as before and the
brute-force protection is intact. Verified on the served site: 18 consecutive renders, zero
degraded, against 4 in 15 before.

Two things were repaired along the way and are worth knowing:

- `ADMIN_SECRET` and `STATS_TOKEN` on the site host each carried a trailing newline that the API
  host did not have (43 vs 42 characters, 65 vs 64). Both are now byte-identical to the API's.
  This was **not** the cause of the outage above, but a header value with a newline is a latent
  trap, and the two values had silently diverged.
- Do not read a one-off "unavailable" card as a defect of the measure behind it. The fallback was
  checked on the served site and is correct: the title, the sentence saying no zero is inferred,
  and not a single digit.


**The report purchase path, hardened on 10 September (#180).** Worth reading before touching
`src/lib/audit-jobs.ts`, `src/routes/audit.ts` or the Stripe webhook, because several of its
guarantees are easy to undo by accident:

- **One Checkout reservation per report.** Creation carries a stable idempotency key derived from
  the report id, so a retry after a network cut reuses the same session instead of opening a
  second one. Before this, a second session could leave the first payer unable to download what
  they had paid for.
- **The first genuinely paid session is fixed atomically with the sale**, and the sale row
  outlives the report file. A different session paying afterwards is an *incident*, reported as
  such: no second delivery is performed and no refund is claimed. The confirmation e-mail links
  the session that actually paid, not the one carried by the event.
- **One receipt per payment**, keyed by a hash of the session id, so a retried webhook does not
  send a second message and does not silence the next incident.
- **Card only, and a Checkout that expires five minutes before the report does.** A first
  creation is refused when less than thirty minutes remain. The two-hour unpaid and twenty-four
  hour paid retention windows are unchanged. Enabling a deferred payment method here would sell
  access to a file that will be gone before the money arrives.
- **Notifications are sent after the local receipt, with no outbox.** A cut just after that
  receipt can lose the message: never promise guaranteed e-mail delivery.
- The audit statistics now sum the **amounts actually recorded** in Swiss francs, keep a known
  zero distinct from an unknown amount, and count foreign-currency payments out separately. They
  are not a revenue ledger and do not reconstruct history.
- The migration that carries this is additive: the column is in the create statement and added by
  a guarded `ALTER TABLE`. An older build ignores it — but rolling back must not restore the old
  behaviour of one new session per click.

**Sales indicators, 10 September (#181).** A private route, `GET /v1/admin/pack-sales`, sums the
payment amounts actually retained on credit keys, grouped by payment reference, excluding granted
and internal keys — a key rotation is no longer a sale. It reads key metadata only: no wallet, no
chain call. The dashboard tile and its detail share one read and one formatter, so they cannot
disagree, and the figure does not depend on the wallet card being reachable. The frontend guard
refuses a payload from an older API — wrong version, wrong scope, or counts that do not add up —
and the page then says the amount is unavailable rather than showing a catalogue total.
**This number is neither profit nor a complete ledger**: it excludes subscription renewals, file
audits, refunds, fees and costs, and the copy on the page says so.

**A pre-existing hydration bug, measured on 10 September.** The operator dashboard raises React
error #418 in French and German, never in English, because some numbers are grouped one way by
the server and another way by the browser. It reproduces on the deployment *before* that day's
work as well, so it is older than any of it. This is the failure class this codebase knows best;
the fix is to route those numbers through `frontend/lib/format-grouped.ts`, as the wallet card now
does.

**Landed on 10 September, after this file was written.** Two branches prepared by a second
agent were reviewed, merged and published: the address timetables and the API comparison in
three languages (#178), and the subscription link that a key rotation used to drop (#177).
Both are on `main`, the API runs the merged commit and both domains serve the new site. The
comparison had been claiming that Java and .NET have no SDK, which stopped being true; the
timetable pages still announced an EPC deadline the EPC has since postponed. Neither change
touches prices, quotas or the signup path.

**A ninth register (Greece).** Written permission for commercial reuse was granted on
8 September under two conditions: an exact credit line, and a disclaimer reproduced in full
on every response carrying that data. The work exists on local branches that have never
been pushed, so a cloud agent cannot see it. It was first built treating the country as an
*authoritative* register, which is wrong — the published file lists credit institutions,
not the whole code allocation, so a real payment institution's code would be answered "not
allocated". The switch to the partial path is decided and under way. **Do not start over.**

**Précision reçue le 14 septembre 2026.** La HBA confirme que HEBIC ne couvre pas les
établissements de paiement et de monnaie électronique émettant des IBAN grecs ; elle renvoie
à la Bank of Greece pour leurs codes. Le traitement partiel reste donc obligatoire avant
intégration. Elle confirme aussi qu'aucune date exacte de publication n'est fournie : citer
l'édition et la date de consultation séparément, sans inventer de date. Les conditions
actualisées, ainsi que les réponses de la NBS, de Betaalvereniging Nederland et d'AusPayNet,
sont consignées dans `docs/data-sources.md`. Cette mise à jour ne modifie aucun registre.

**Moving the site off Vercel to a Swiss VPS.** One commit on `vps-migration`: a container
image for the site, a workflow that builds on GitHub and ships over a restricted SSH key
that accepts a single command, and the legal texts updated for the new sub-processor. The
API does not move. The chain has been proven end to end. Three things must be handled
before merging: the runtime environment variables the site needs are not carried into the
container by anything visible in the repository; the workflow still triggers on its own
branch, which its own comment says to remove at merge; and the legal texts carry a future
date, which must follow the cutover rather than precede it.

A fourth item was added on 10 September, and it is an acceptance criterion, not a detail. On
a standalone `next start` server built from that branch, the unprefixed English routes
(`/compare`, `/docs/structured-addresses`, the timetable article) answered 308 to their own
address — a redirect loop. The public site serves all three at 200, confirmed in WebKit with
an English browser. `middleware.ts`, `i18n/routing.ts` and `next.config.ts` are identical to
`main`, so the cause is not a difference in configuration; the working hypothesis is an
interaction between the local rewrite and the `/en` redirect. **Reproduce it and close it on
the candidate server before touching DNS**, and do not delete the SEO redirects on a hunch:
locale detection means an unprefixed URL legitimately serves a different language depending
on the browser, so a naive fix breaks something that works.

**The keyless trial is twenty-five calls a week since 24 September, with no e-mail and no
key** (twenty-five a day from 15 September, lot 4 of the "key without e-mail" chantier). The constant is used
properly inside `src/`; the surfaces that still write the number by hand are counted by
`src/lib/trial-figures-static.test.ts`, whose cap only goes down. The README and the
onboarding page were the last two to say ten (fixed 16 September).

**Versions 1.6.0 and 1.7.0 were both released on 15 September 2026.** 1.6.0 carried PR 197
(the MCP output schemas now match what the enrichment serves, so the official client stops
rejecting valid answers; the npm package bounds its requests and no longer expands a refused
batch; both SDKs create a key without an address; the two audit tools of the npm package ship
with it). 1.7.0 carried the **device grant** (RFC 8628): `src/lib/device-grant.ts` holds the
whole quota guard, `src/routes/device-grant.ts` the five routes, `frontend/app/[locale]/device/`
the approval page, and the two tools `request_api_key` / `poll_api_key` live on the three MCP
surfaces (the remote one calls the module directly with a mutable per-session call context and
binds the remembered `device_code` to the network fingerprint that opened it; the npm package
and the stdio server of this repository relay over HTTPS). Two things to know before touching
it: the per-network daily budget is **shared in both directions** with `POST /v1/keys/generate`
(a pending request is a promised key, and `generate` reads the same sum), and `device_codes`
must never enter the backup (it holds the key in clear until the single collection). The
adversarial review of the lot found no blocker; its seven findings were fixed the same evening
(revocation with `deactivated_at`, the race between two approval tabs, the 404 delays counted
in `pollsInFlight`, a token issued without a row, the extension capped at two lifetimes, the
`device:polls` probe, the 429 in the contract). Spec: `docs/internal/…/spec-04-device-grant-mcp.md`
(internal); what is still an extension is listed there (§2.8 session cap and max-fair eviction,
the farm replay).

**The measurement now follows agent identities** (same evening, after the device grant).
`lineage_facts` gained `first_success_client` and `last_success_client`, a client family taken
from a closed list (`src/lib/lineage-clients.ts`, derived from the User-Agent prefixes the SDKs
and the npm package actually send; the User-Agent itself is never stored). Two daily aggregate
tables, `device_grant_daily` and `mcp_remote_daily` (`src/lib/agent-entry-daily.ts`), are
incremented by the routes and the purge at the moment a decision is taken, because
`device_codes` is purged after 24 hours and the remote MCP surface logs no tool name — they
are the only durable trace of the device rail and of the keyless MCP top of funnel, which is
why they entered the backup (format 7) while `trial_daily`, recomputable from its ledger, did
not. `GET /v1/admin/funnel` keeps every key it had and adds `by_birth_source` (capped at
twelve named doors plus `(other)`), `by_first_client` (ten buckets that partition the cohort,
including `(unknown)` for lineages activated before the family was recorded and `(none)` for
lineages never activated) and a `device` block (counters, the chain from opened to delivered to
born lineages, the three indicators, and `mcp_remote` with its note: calls without identity,
never counted as activations). One dead attribution path was found and repaired on the way:
a key born from a verified e-mail code never went through `claimKey`, so its lineage never got
`claim_method` and a card purchase could not be linked to it; `recordLineageBirth` now reads
both fields from `api_keys`. On the first production read `device_grant_daily` starts empty
while device lineages already exist, so the `chain` ratios come back `null` and
`not_yet_measurable` rather than zero.

**Agents launched in a worktree may start behind the announced revision.** Observed on
15 September: a worktree created for a reviewer opened at the base commit, not at the head the
brief named. Every brief now asks the agent to check `git rev-parse HEAD` first and to move to
the named revision itself. A heredoc that is not quoted (`<<EOF` instead of `<<'EOF'`) executes
the backticks of the brief it writes; quote it and substitute variables with `sed` afterwards.

**The UK firm lookup answers 503** (`not_configured`) until two environment variables are
set. It was built blind, with a one-day cache and no stale grace because the described
usage promises exactly that, plus a test that fails if any CRM module imports the client.

**Full audit of 16 September 2026.** Five read-only audits (security, data and registers,
product and revenue, code and delivery, production operations) live in
`docs/internal/audit-2026-09-16/` with an HTML report beside the roadmap. What they changed the
same day: the daily backup of the paid state on the VPS had refused the new export format since
that morning (fixed and re-run), the ops feed cursor is now AES-encrypted instead of XOR-masked
(consecutive cursors carried the throughput), the key-delivery alert closes itself again after a
delivered key, the bazaar extension carries the `schema` the x402 core requires, the UK firm
route leaves the OpenAPI contract while the FCA credential is absent, `localhost` is no longer an
accepted CORS origin in production, the forget-customer script covers every table that stores an
address (guarded by a discovery test, like the admin routes now are), `next build` and the IBAN
registry drift run in CI, and `main` refuses force-pushes and deletion. What still waits for a
decision is listed in the report.

**The decisions of that same evening, and their mechanics.** The entry credit pack costs $4
(a new Stripe Payment Link with the same `bundle: 1k` metadata; the $5 link is deactivated), and
the creditor file audit is sold in US dollars: the API fields `price_chf` became `price` plus
`currency`, the two audit tables gained a `currency` column by migration (`CHF` for the rows of
before, `USD` since), and the admin statistics count dollars and francs separately, never
added. Pro subscribers have a Stripe customer portal (login page, cancellation at period end),
cited in §3 of the Terms (version 1.5). Finland moved from `NATIONAL_REGISTERS` to
`NON_EXHAUSTIVE_REGISTERS`: its list is a hand transcription that nothing refreshes, so a miss
falls through to the composite answer instead of a denial; it goes back up once the list is
re-read. Four permission letters left for the Austrian, Belgian and Finnish registers and for
EBA CLEARING (`docs/data-sources.md`, section of 16/09). And the backup is finally tested:
`npm run backup:restore-test <paid-state.json>` replays a dump on a throwaway database and
compares what came back to what the file announces; a launchd job on the operator's Mac runs
it on the first of each month and reports on Telegram.

---

## 10. Known debts, by weight

**Heavy.** `main` unprotected while a push deploys production · no `next build` in CI and
no component tests over the largest client-side surface · the missing verbatim attribution
of section 5 · two authoritative registers with uninstructed licences.

**Medium.** A key rotated *before* 10 September carries no subscription link, because the
rotation used to drop it: `deactivateBySubscription` cannot find such a key, so a cancellation
leaves it working. The fix protects every rotation from now on and deliberately repairs
nothing retroactively. How many keys are in that state cannot be read from this repository,
and the repair — matching old keys back to their subscription — is a decision with money on
both sides, not a cleanup to run quietly · the npm release path does not do what the
documentation says · the release
workflow can go green while publishing nothing · `src/routes/api-keys.ts` and
`src/lib/stats.ts` each mix two trades in one very large file, which is exactly how two
agents collide · the free-tier quota is retyped in three files · the writable database's
real schema lives in code while `src/db/schema.sql` still carries a dead four-table version
of it · Vercel's configuration exists only in its dashboard, so the site cannot be
reconstructed from a clone · several Dependabot pull requests sit green and unmerged, and
the frontend limit has been hit before, which silently stops security updates too.

**Light but worth a line.** The comparison page states a competitor's Standard plan as 60 000
requests **per month** for $99. Re-read on 10 September, that vendor's own API page reads
"$99/month (billed annually)" and "60 000 requests / year" — the same price over a period twelve
times longer. The figure predates the September rewrite, which only reformulated the line around
it, and a single automated read of a page driven by a monthly/annual toggle and a volume slider
is not enough to overwrite a claim about a named third party. Check it by eye with the toggle set
to monthly, then correct or confirm — the page invites corrections in writing, so leaving it
wrong costs more than the fix · four versions were published without a git tag, which makes the
release notes of their successors wrong · one SDK is on the artifact repository but absent
from its public search index · a handful of orphaned frontend components and one dead
module that still carries a hostname · the content security policy has never left
report-only · two independent implementations of "the Swiss day" coexist.

Security posture, for context: an internal adversarial review in September found no
critical issue; four low-weight items are dated and tracked in `docs/internal/`. Do not
publish an open finding — describe the class, never the payload.

---

## 11. Where to start

1. `AGENTS.md` — the rules. It wins over this document.
2. `src/lib/enrich.ts`, the two register maps and the docstring above them — section 3.
3. `docs/data-sources.md` — before touching any register.
4. `RELEASING.md` — before touching any version number.
5. Sections 8 and 9 here, so you neither repeat a paid-for mistake nor restart work in
   flight.

Two reflexes to install before the first line of code. Before announcing anything is fixed,
deployed or live, run the command that shows it and paste the output: a successful push is
not proof of deployment, a clean tree is not proof of deletion, and a green CI is not proof
that the production image boots. And before declaring an access missing, try it and quote
the failure.


## 12. Espace de travail CRM — refonte du 15 septembre 2026

La navigation protégée utilise une barre latérale à partir de 1 100 px et une barre basse
sur téléphone. Les styles et les couleurs de travail restent limités au layout du dashboard.
La vue d’ensemble conserve sa route et accepte `view=today|revenue|growth|service` ; un ancien
lien ouvre `today`. Le paramètre `period=7|30|90` reste attaché au passage entre les vues.
Les conversations à traiter apparaissent avant le résumé des revenus. Les sections détaillées
ne déclenchent leurs lectures que dans la vue qui les utilise. Les alertes de collecte périmée,
les refus de paiement et la distinction entre zéro et donnée indisponible restent visibles.

Contacts propose quatre files permanentes, une recherche et deux filtres explicites. Les
compteurs des files respectent la population et la précision choisies, avant la recherche.
Les actions de ligne passent par un menu visible au toucher ; le balayage caché est retiré.
Les règles de sélection, de gel de l’ordre pendant une lecture, de garde du brouillon et
les routes de mutation restent celles des modules CRM existants. Courrier ouvre la fiche
depuis toute la ligne. Clients sépare recherche, filtrage et tri, et utilise `formatGrouped`
pour garder les nombres identiques entre Node et WebKit.

Recette locale avec données entièrement fictives, sans copie de base ou de secret de production.
Les tests dédiés couvrent les liens vue/période, les compteurs filtrés, les files vides,
l’accès aux actions et le rendu des nombres dans les trois langues. La publication et la
recette finale sur le domaine authentifié restent à l’intégrateur principal. L’ancienne
boucle de redirection anglaise du serveur Next local (section 9) reste hors de ce chantier.

## 13. Accueil autour de la lentille

`frontend/components/lens/` réunit le testeur, la scène 3D chargée à la demande et les
illustrations. Le testeur appelle le relais existant `/api/playground` uniquement à la
demande. Il ne stocke pas la saisie, annule les requêtes périmées et efface les résultats
dès une modification. `response.ts` reprend le verdict partagé du playground : un
format valide ne confirme pas une banque et une absence dans une source partielle ne
devient pas un refus. Les sources, dates, crédits et réserves reçus accompagnent la réponse.

Le moteur conserve une image fixe de secours, la pause, la réduction des mouvements et
l’arrêt hors écran. Le gros plan crée son moteur à l’ouverture et le détruit à la
fermeture. Les images et polices de `public/brand/lens/` portent une empreinte dans leur
nom ; si leur contenu change, renommer le fichier et actualiser `assets.ts` ou le CSS.
Les licences des polices restent à côté des fichiers. Aucun secret ou dépendance de
base de données ne doit entrer dans cette partie cliente.

Deux choses relevées à l'intégration, à savoir avant de chercher une panne ailleurs :

- Le périmètre de vitest du site ne couvrait que `lib/` et `app/`. Le fichier de tests
  arrivé avec la lentille vivait sous `components/` : vitest ne le trouvait pas et
  sortait vert sans lui. `components/**/*.test.ts` a été ajouté à l'`include` de
  `frontend/vitest.config.ts` ; un test placé ailleurs que dans ces trois dossiers ne
  tourne toujours pas, et son absence ressemble à un succès.
- Les deux mesures du film (`film:start`, `film:end`) du tableau de bord affichent
  désormais zéro en permanence : le film qui les émettait a été retiré de l'accueil avec
  ce chantier. Ce n'est pas une panne de collecte.
