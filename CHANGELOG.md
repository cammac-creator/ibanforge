# Changelog

All notable changes to IBANforge are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **`sepa.vop_participant` on every validate response** — bank-level VoP readiness: `true` when the resolved institution is listed as *ready* in the EPC Verification of Payee scheme register (refreshed weekly), `false` when it is not, `null` when no institution was resolved. Country-level duty stays in `sepa.vop_required`. Under the Instant Payments Regulation, euro-area PSPs answer VoP since 2025-10-09 and payer-side real-time checks apply since April 2026 — this field answers the half an integrator needs *before* initiating: is the recipient bank reachable for VoP at all? New [/docs/vop](https://ibanforge.com/docs/vop) page (EN/FR/DE) with the regulatory dates and the limits stated plainly.
- **`bank_code_check.institution`** — what the national register publishes about the institution holding the bank code, served only on authoritative answers: full seat address for CH/LI (SIX) and AT (OeNB, plus the LEI), postal code + town for DE (the Bankleitzahlendatei has no street column), name only for BE (the BNB file has no address at all). Absent fields are `null`, never guessed; Finland stays without the block (its codes belong to banking groups). This is the institution allocated the code — not a branch, and not proof of any account.
- **Terms acceptance at the moment of commitment, on all three sales rails** — the key dialog and the API landing form show an acceptance notice (EN/FR/DE), `POST /v1/keys/generate` returns `terms_url`, every 402 body carries a `terms` field, and the pricing page, Stripe success page and key-delivery emails link the Terms and the 14-day refund rule for unused card-paid packs.
- **Right-to-erasure tooling** — `scripts/forget-customer.cjs` deletes everything attributable to one customer email across every table that holds it (dry run by default), so the "deleted on request" promise in Privacy §4 / DPA §8 is honoured within its 30-day window.

### Changed
- **Privacy Policy v1.1 and DPA v1.2** — the hosting region is now stated truthfully everywhere (Railway's **Amsterdam (EU)** region; only Railway's network edge sits in Zurich — for EU controllers processing stays within the EU, for Swiss customers the EU is adequate). Processor list completed (AI drafting assistance under redaction rules, CI infrastructure, dashboard traffic through Vercel functions, the x402.org fallback facilitator) and a new privacy section describes business contacts and prospecting, with the opt-out. Each document carries a dated revision note.
- **Served copy now promises only what the product performs** — "vet a counterparty IBAN" became "check the bank behind a counterparty IBAN" across every descriptor (llms.txt, OpenAPI, MCP stdio+HTTP, discovery manifests, 402 bodies); the vendors page says "issuing bank identified" instead of "bank exists"; the "Live · Zurich" badge says "Live · Europe". MCP tool triggers no longer invite "is this a real bank" / "will the payment go through" questions, and `validate_iban` states its LIMITS explicitly. A repo-wide guard test (now scanning `.mdx` too) forbids account-level-verification phrasing from returning.
- **Retention now covers every per-request table** — the 12-month purge reaches `operations` (where invalid-IBAN prefixes live) and `feedback`; the DPA 4.7 termination purge reaches `operations`; never-retrieved one-time key views are cleared after 7 days; the feedback endpoint stores the client IP as the same salted hash used everywhere else (existing rows migrated, raw column dropped). Owner Telegram notifications no longer carry customer email addresses.

### Fixed
- **The EU sanctions feed silently degraded on 2026-08-02** — the weekly refresh ran in a CI environment where the EU consolidated-list download failed inside a best-effort catch, and the workflow committed a database whose served "(OFAC, EU)" coverage claim had become false. Database regenerated from the primary sources; the refresh workflow now runs the claims-vs-database guard test *before* it is allowed to commit, so degraded data fails loudly instead of shipping a lie.
- **Eight reserved Belgian bank-code slots were stored as allocated banks** — the BNB register writes *Onbeschikbaar* (unavailable) for slots it reserves, and the seeder kept them, so code 539 — the bank code of the web's favourite example IBAN — resolved to a bank literally named "Onbeschikbaar". Reserved slots now drop like VRIJ ones and the example IBAN gets the authoritative `not_in_register` it deserves.
- **`ibanforge-mcp` 1.4.2 published** — every outputSchema now declares nullable issuer types (an enum without `null` made MCP SDKs silently drop `structuredContent` on exactly the answers that matter most), `bank_code_check` / `next_steps` / `vop_participant` are declared, and the `kyc` / `aml` npm keywords are gone — they recruited the regulated name-screening use the Terms explicitly exclude.

### Fixed
- **⚠️ `/v1/iban/compliance` no longer returns a reassuring verdict for an IBAN it could not read.** An IBAN that failed validation (bad checksum, unknown country, wrong length) was still scored, and scored **10 / `low`**: the two "we could not check" penalties (`no_sepa_instant`, `no_vop`) added up to just under the 20-point `medium` threshold, so the less the API established, the safer its answer looked. Measured in production, a one-character typo took a Russian IBAN from `critical` / 90 / `sanctioned_country` down to `low` / 10. Such a response now carries `risk_score: null`, `risk_level: "unassessable"` and `flags: ["iban_invalid"]`. **`unassessable` is the absence of a verdict, never a favourable one** — do not fold it into a "safe to pay" branch. The scoring model itself is unchanged: a valid IBAN scores exactly as before.
- **The same fix reached the MCP transports, not only REST.** The compliance response was assembled by hand in four places (REST route, HTTP MCP, stdio MCP, demo) and two had already drifted: the HTTP MCP transport — the one agents actually reach at `/mcp` — was the only surface omitting `meta`, so it never carried the `bank_bic_only` disclaimer; and three of the four derived country risk from a field that is absent when BBAN parsing fails. All four now call one shared assembly (`buildComplianceResponse`), which closes both divergences for free.

### Changed
- **Dataset sizes are read from the data, not written by hand.** Twenty-four files announced how much data ships, in four different values: the Swiss clearing table holds 1,165 rows and the product said "~1,200" sixty-one times, "1190+" once, "1,000+" four times. Served surfaces now interpolate `datasetFacts()`; static files (copy, manifests, the three locales) keep a literal that a test holds to be **less than or equal to** the live count. Every formatted figure rounds DOWN, so a claim survives a monthly refresh instead of becoming false the day it is written.
- **Latency claims say what they measure.** The five x402 trust tags said "p99 <50ms / <30 / <20 / <80 / <300" with no unit stated; server-side processing is 0.55 ms median but a client in Zurich observes p50 132 ms. And the MCP descriptions contradicted the x402 tags on batch by a factor of ten. One honest bound now, naming `GET /ping` so the caller can measure the network half himself.
- **MCP `lookup_bic` now also returns `country: { code, name }`**, the shape REST has always used and that `validate_iban` already shared. The flat `country_code` / `country_name` pair is kept and **deprecated since 1.4.0, removed no earlier than 2027-01-01**. The two differ on the missing-name fallback on purpose: `country.name` falls back to the country code, `country_name` still answers `null`.
- **MCP `validate_iban`'s documented shape matches what it returns.** It promised `bic: { code, institution, country_code, city }` and returns `bic: { code, bank_name, city }`; the example showed an 11-character BIC where the service normalises to 8. For an agent the description IS the contract, so this was the expensive place to be wrong.
- **`meta` now dates both country signals.** `risk_indicators.country_risk` is a separate editorial AML axis layered on top of `compliance.sanctions.fatf_status`, not a restatement of it, so the two can disagree on a country by design (Bulgaria: grey-listed and standard). Only one of them carried a date, which made a considered difference look like a stale list. Both are dated now and the response states the distinction. The sets themselves are unchanged: deriving one from the other would downgrade sanctioned countries.

### Fixed
- **Swiss bank codes the SIX BankMaster no longer lists are no longer given an institution name.** Four were: `00762` → "UBS Switzerland AG" (the bank code of the canonical example IBAN `CH93 0076 2011 6238 5295 7`, never an allocated IID — a fixture that leaked into production data), `31100` and `83036` → "radicant bank ag", `83015` → "`++MBaer Merchant Bank AG in Liquidation`", literal `++` artifact included. Pruned at load time against the register rather than edited out of the JSON, so the next monthly refresh cannot re-create the problem. Those codes now answer `bic: null`, which is the truth for an unallocated bank code.
- **`compliance.risk_score` is now nullable and `compliance.risk_level` gained the value `unassessable`.** Declared everywhere the contract is published: OpenAPI, the x402 discovery schema, both MCP output schemas, and the TypeScript and Python SDKs. Consumers that switch on `risk_level` or do arithmetic on `risk_score` should handle both before upgrading. The playground now renders an unassessable verdict as a neutral "non évalué · —" chip instead of a green `low · 0/100`.

### Added
- **Telemetry deletion after termination, by default (DPA 4.7)** — request metadata attributable to a customer's API keys is now automatically deleted 30 days after the customer's last key is deactivated (revocation, subscription cancellation), instead of only on request. Key rotations don't trigger it — the customer relationship continues on the fresh key. Runs at boot and daily, next to the existing 12-month purge. DPA revised to v1.1 (numbered clause 4.7 + new Annex I with the full description of processing); Privacy Policy retention summary updated. +4 retention tests.
- **Full BBAN structural validation (all 89 countries)** — `/v1/iban/validate` now enforces the SWIFT IBAN Registry character structure of the BBAN on top of length + mod-97. `DE17ABCDEFGH1234567890` (letters inside Germany's all-numeric bank code, mod-97-valid) is finally rejected with an agent-friendly `invalid_bban_structure` detail naming the field, the position and the expected charset. Check digits `00`/`01`/`99` (outside the ISO 13616 range 02–98) and non-numeric check digits are rejected as `invalid_check_digits` — `CH99…` used to validate. Patterns are cross-checked against three sources (registry Release 101 via python-stdnum, schwifty, ibantools — 8 ibantools divergences resolved against the registry) and precompiled at module load (hot path unchanged, ~0.0015 ms). A registry-conformance suite validates all 89 official sample IBANs to guard against over-rejection.
- **BBAN decomposition for the 47 missing countries** (incl. SEPA members BG, RO, IS): they previously returned an empty `bank_code`, silently disabling BIC lookup, issuer classification and `risk_indicators`. `/v1/iban/structure/:country` now exposes per-field SWIFT charsets (`4!a`, `8!n`…), the full `bban_pattern`, and an official example IBAN for every country (was 26).
- **Explicit paywall cause in 402 responses** — when a request falls through to the paywall because of an *exhausted monthly quota*, *used-up credit bundle* or *invalid/revoked API key*, the 402 body now carries a `cause` object (`reason`, `detail`, plus quota/credits numbers) and a message stating the real situation, instead of the generic "authentication or payment required" that reads as "you are anonymous" to an authenticated client. New `X-API-Key-Invalid` header on the broken-key path. +3 integration tests. (Micro-audit conversion 2026-07-03: a trial user dying silently on the quota wall is invisible churn.)
- **MCP npm package 1.3.2 tells the truth on degraded results** — the stdio package now relays the 402 `cause` in its `_hint`, labels quota/credits/key-caused fallbacks as `DEGRADED RESULT` (instead of the misleading "Anonymous mode" when a key is configured), no longer masks an invalid-IBAN 400 behind a "payment required" message, and stops promising that an API key raises the per-IP rate limit (it does not).
- **Self-service API-key lifecycle** — `POST /v1/keys/revoke` (kill a leaked key, idempotent) and `POST /v1/keys/rotate` (mint a fresh key that atomically inherits the email, monthly limit and remaining credits, then deactivates the old one). +7 regression tests.
- **TypeScript SDK test suite** — 25 Vitest specs (mocked `fetch`): base-URL normalization, Bearer-auth headers, request shapes, `validateBatch` input guards, full HTTP-status → typed-error mapping (401/403/402/429-quota/429-rate/4xx/5xx), timeout/network wrapping, and the `usage()` no-key precondition. The SDK previously had zero tests. Both SDK suites now run in CI on every push.
- **Monthly Swiss-clearing refresh** — the `ch_clearing` table (SIX BankMaster) is now reseeded and committed by the existing monthly database cron, in the same workflow as the BIC database (both live in `data/bic.sqlite`, so one workflow / one commit avoids a same-file race).

### Changed
- **Bank-level sanctions are now built from primary sources** — OFAC SDN (US public domain) as the spine, with EU / UN / SECO consolidated lists best-effort — removing the runtime dependency on the CC-BY-NC OpenSanctions dataset. Country-level FATF/sanctions signals are unchanged. Net effect on BIC8 indicators: identical coverage minus one entity.

### Fixed
- **Batch validation now bills 1 credit per IBAN on API keys** — a `/v1/iban/batch` call of N IBANs debits N free-tier requests or N prepaid credits. Previously a whole batch billed a *single* unit, so a 100-IBAN batch cost the same as one validation — a ~100× underbilling that x402 callers never got (the x402 price was already $0.002 × N). Billing is all-or-nothing: a batch that exceeds the remaining allowance is refused with a machine-readable 402 naming the shortfall (`credits_insufficient` / `monthly_quota_insufficient` causes, `X-Credits-Required` + `X-Credits-Remaining` / `X-Quota-Required` + `X-Quota-Remaining` headers) and nothing is consumed; handler-level 4xx rejections refund the full pre-charge. Successful multi-unit charges are surfaced via `X-Credits-Charged` / `X-Quota-Charged`. Bundle descriptions now say "credits" instead of "calls" across the OpenAPI spec, x402 discovery metadata and llms.txt, and the batch's "10x cheaper" claim is corrected to the real 2.5× ($0.002 vs $0.005 per IBAN).
- **Russia FATF status was 'member'** — factually wrong since its suspension on 24 Feb 2023. New `suspended` status (surfaced as-is in `sanctions.fatf_status`), scored at least as severely as non-membership (+10, `fatf_suspended` flag). FATF lists synced to the 17–19 June 2026 plenary: grey list +BA +IQ / −DZ −NA (22 jurisdictions), black list unchanged, `fatf_as_of` → `2026-06`.
- **Compliance under-scored countries without a BBAN structure** — country risk was read from `risk_indicators` (absent when BBAN parsing failed) and silently fell back to `standard`: production RU scored 60/high *without* the country flag. The country-risk axis is now derived straight from the country code; RU answers ≥80/critical with `high_risk_country` + `sanctioned_country` + `fatf_suspended`.
- **Revolut LT IBANs answered `sct:false, no_vop`** — Revolut Bank UAB is EPC-registered under `RVUALT2V` while its customer IBANs resolve to BIC `REVOLT21`; the BIC8 join missed the membership. Documented EMI-alias step (refresh script + data): REVOLT21 now reports SCT / SCT_INST / SDD / VoP-ready. Wise (TRWIBEB1/TRWIGB22), N26 (NTSBDEB1) and Bunq (BUNQNL2A) verified already present under their IBAN-facing BICs.
- **188/189 EBA STEP2 BIC entries had `found:true, institution:null`** — the seed read the XLSX 'Comment' column instead of the institution-name column. Seed fixed and all 188 names backfilled from the official EBA file (e.g. `ATPIITM7XXX` → "A-Tono Payment Institute"); zero nameless entries remain across all sources.
- **QR-IID lookups were semantically inverted** — `GET /v1/ch/clearing/30000` answered `iid:"30000", qr_iid:"9000"`. BankMaster QR rows (range 30000–31999) carry the institution's *standard* IID in their QR-IID column; the lookup now presents `iid` = standard IID (`09000`), `qr_iid` = the queried QR-IID (`30000`), plus `is_qr_iid: true` and an explanatory note. Standard-IID lookups are byte-identical to before; QR-IBAN enrichment gains the same corrected semantics.
- **Spoof-resistant client-IP extraction** — rate-limiting and stats now read `x-real-ip` (or the *last*, trusted-proxy hop of `X-Forwarded-For`) instead of the attacker-controlled first segment, so a forged `X-Forwarded-For` can no longer rotate around the rate limiter. Single shared extractor (`extractClientIp`) used by both call sites.
- **Swiss-clearing seed sanity floor** — `seed-bc-nummer.ts` aborts *before* dropping `ch_clearing` if the SIX BankMaster feed returns fewer than 800 rows, so a truncated download can never wipe the ~1190-row table under the unattended cron.

### Notes
- Two audit findings were investigated and confirmed **false positives** (no change, now documented in code): `qr_iid` is a genuinely distinct allocation column (not a copy of the clearing IID), and `getCountryRisk` is a deliberately separate AML axis that stacks on top of the DB FATF/sanctions signal — re-deriving it from the FATF table would *downgrade* sanctioned/grey-listed country scores.

## [1.3.2] — 2026-06-03

### Fixed
- **Python SDK now ships its `py.typed` marker** (PEP 561). The package already advertised `Typing :: Typed`, but without the marker file downstream `mypy`/`pyright` silently ignored the inline type hints. `pip install -U ibanforge` (≥ 1.3.2) now gives type-checked autocompletion and signature checking. _Python SDK only — the API, npm SDK and MCP server are unchanged at 1.3.1._

## [1.3.1] — 2026-05-30

### Fixed
- **Broken copy-paste SDK examples on `/agents`** — corrected field names to the real response shape (`bank_name`, `sepa.member`, `risk_indicators.country_risk`, `compliance.risk_score`/`risk_level`, `validateIban(iban)`), plus stale country counts.
- **Coherence pass** — every remaining "75+ countries" string aligned to the real **89** (layout meta in 3 languages, OG image, landing FAQ/meta/H3, blog articles, footer version, published MCP enum).

### Changed
- Frontend: wired the free-key modal end-to-end, lead with the Swiss / MCP USP, 3-rail pricing.
- `/fr/famille` reworked into a clear, illustrated FAQ.
- **Release process** — hybrid procedure documented (`RELEASING.md`): PyPI + MCP Registry publish automatically (MCP via GitHub Actions OIDC), npm publishes manually behind the 2026 npm 2FA approval gate; `mcp-publisher` installed from its release binary.
- TypeScript SDK published as `@ibanforge/sdk` with corrected package metadata and an accurate README.

## [1.3.0] — 2026-05-29

### Added
- **BBAN structure for LT, EE, LV, MT, CY** — revives EMI / virtual-IBAN detection in those jurisdictions.
- **EBA Clearing STEP2 SCT** as an official SEPA reachability source (+201 BICs); EMI classification extended via the EBA / FCA registers.
- **Compliance transparency** — every response now discloses scope, a disclaimer, and data-freshness metadata.
- **Discovery surfaces** — `/agents.txt` plain-text index, `agent.json` and `mcp.json` path aliases, regenerated `llms.txt` / `mcp.json` to 1.3.0 truth.
- **Stripe Checkout credit-pack rail** + success page that retrieves the API key once.

### Changed
- Hardened the compliance enrichment pipeline (primary-source ingestion).
- Aligned tool schemas and prices across all three MCP surfaces (stdio, HTTP, card).

### Fixed
- Flag `XX`-country BICs as test BICs; cap oversized IBAN input.
- Corrected bank-code drift against the SWIFT IBAN Registry.
- Correctness, data-accuracy and SDK-parity fixes surfaced by the 4.8 multi-agent audit.

## [1.2.0] — 2026-04-29

### Added
- **PyPI Python SDK** `ibanforge` 1.1.0 — `pip install ibanforge`. Sync (`IBANforge`) + async (`AsyncIBANforge`) clients, 6 endpoints (`format_iban`, `validate_iban`, `validate_batch`, `lookup_bic`, `lookup_ch_clearing`, `check_compliance`), 1-line free key generator (`IBANforge.generate_api_key("you@example.com")`), TypedDict response shapes, 6 typed exception classes (AuthError, PaymentRequiredError, QuotaExhaustedError, RateLimitError, InvalidInputError, APIError, IBANforgeError), 16 respx-mocked tests, MIT license. https://pypi.org/project/ibanforge/
- **Free `GET /v1/iban/format` endpoint** — pure mod-97 + structure check, no DB hits, no API key, no quota. Returns valid/invalid + bban breakdown + `upgrade_to_full_validation` hint pointing to the paid `/v1/iban/validate` ($0.005). Lets agents pre-filter malformed IBANs before paying for full enrichment.
- **Glama containerized release** — `mcp/Dockerfile` (two-stage, Node 20-slim, non-root user) registered on https://glama.ai/mcp/servers/cammac-creator/ibanforge. Server Coherence ✅ unlocked, Tool Definition Quality scanning enabled, badge upgrade D → A pending.
- `/agents` page (EN/FR/DE) — agent-first integration guide with 3 paths (MCP, free key, x402)
- `/openapi` page — interactive Scalar API reference (try-it-out, codegen)
- 6 JSON-LD schemas at the layout level (SoftwareApplication, Organization, FAQPage, HowTo, BreadcrumbList, WebAPI) for richer agent + SEO discovery
- Design tokens ported from the previous Vite version: `--ink-0..5`, `--fg-1..5`, `--amber-50..700`, `--swiss-500/600`, `--risk-{low,med,high}`, `--syn-*`, `pulse-live` and `blink` animations, `.eyebrow`, `.kv-grid`, `.endpoint-row`, `.tnum`, `.tracking-caps` utility classes
- Reusable components: `StatusDot`, `RiskChip`, `EndpointRow`, `ApiKeyDialog` with provider
- Per-locale `<title>`, `<meta description>`, `<html lang>`, `hreflang` alternates (EN/FR/DE)
- Compliance-bundle endpoint `POST /v1/iban/compliance` ($0.02) advertised in pricing, calculator, landing
- 5th endpoint `GET /v1/ch/clearing/:iid` ($0.003) advertised in pricing, calculator, landing
- Persistent volume declaration in `railway.toml` for `stats.sqlite` (api keys, quotas, revenue)
- WAL mode + busy_timeout + 5 missing indices on `stats.sqlite` for concurrent throughput
- Permissions-Policy header denies camera/microphone/geolocation/payment/usb
- Content-Security-Policy on HTML responses (landing, MCP card)
- `IBANFORGE_FREE_MODE` env flag for explicit production free mode (loud warning)
- Trust signals appended to all 5 paid 402 descriptions (production status, p99 latency, dataset size, version) — agents that filter on description quality reward this
- `outputSchema` with bare-output examples on every accept entry (CyberSapper recipe from CDP Discord) — unblocks CDP catalog + agentic.market indexing

### Changed
- `ensureWalletConfigured` now fail-closes in production: missing `X402_ENABLED` or `WALLET_ADDRESS` triggers a boot crash instead of silent fail-open
- API-key middleware: when monthly quota is exhausted, the request now falls through to the x402 middleware (advertises payment requirements) instead of returning a hard 429 dead-end. Agents can keep using IBANforge by paying per call.
- Dashboard auth refactored: `SESSION_SECRET` is now a distinct env var (not the password), session token includes a signed `iat`, comparison is timing-safe
- CORS_ORIGIN must be explicit in production (no wildcard); boot crashes if missing or `*`
- Frontend `next` upgraded 16.2.2 → 16.2.4 (fixes high-severity DoS advisory in Server Components)
- Backend `npm audit fix` resolves transitive postcss/hono path-traversal advisories

### Fixed
- Per-locale metadata was being overridden on the home route by a static EN export — removed the override so `/fr` and `/de` now serve localized titles + descriptions
- `<html lang>` was always `en` regardless of locale
- 30+ hardcoded user-visible strings (Copy/Copied in code blocks, uptime tooltips, locale-aware date formatting in monitoring) now go through `next-intl`
- 2 blocking ESLint errors (setState-in-effect, JSX-in-try/catch) resolved
- Stale dashboard rate-limit comment clarifies per-Lambda scope

### Security
- New `SESSION_SECRET` requirement for dashboard cookies (independent of password)
- Constant-time login response delays prevent timing-attacks
- CSP + Permissions-Policy on HTML
- Strict CORS in production

## Operational

The website is now served by the Next.js project (Vercel project `ibanforge`, repo subfolder `frontend/`). The previous Vite design-system project (`ibanforge-design-system`) is orphaned (no domain attached) and can be archived after a 30-day rollback window.

## Migration notes

For self-hosted deployments:
1. Set `SESSION_SECRET` in production (`openssl rand -hex 32`)
2. Set `CORS_ORIGIN` to an explicit comma-separated list of your origins
3. Verify the Railway volume is mounted at `/app/data` (boot logs warn if not)
4. To run in explicit free mode in production, set `IBANFORGE_FREE_MODE=true`
