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
3. **A refusal closes a source completely** — none of its data may enter the repository or
   the API. One payment network has refused.
4. **A register's own robots file is respected as policy.** One central bank names our
   crawler; that is not something to "fix" with a user-agent rotation.

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
branch in the main working tree; use a worktree. And `.gitignore` must say `node_modules`
without a trailing slash, or an agent's symlink gets committed and replaces the real
directory at merge time.

**A comment is a public surface.** Reasoning stays, quantity goes. This class has been
purged repeatedly and comes back through test fixtures and through directories the previous
sweep did not look at. A commit message cannot be rewritten once pushed, and the message
that *repairs* such a leak must not describe what it removed.

---

## 9. Work in flight

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

**The keyless trial goes from ten calls a day to twenty-five, with no e-mail and no key.**
Decided 9 September, **not yet in the code**. The constant is used properly inside `src/`,
but the number is written out by hand in roughly twenty documentation surfaces, the three
message catalogues, the machine-readable files and the README. Changing only the constant
would leave those lying.

**Version 1.6.0 is unreleased.** Two audit tools are written and tested in the MCP package
(eleven tools) and wait for it.

**The UK firm lookup answers 503** (`not_configured`) until two environment variables are
set. It was built blind, with a one-day cache and no stale grace because the described
usage promises exactly that, plus a test that fails if any CRM module imports the client.

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
