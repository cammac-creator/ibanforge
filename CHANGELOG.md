# Changelog

All notable changes to IBANforge are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `/agents` page (EN/FR/DE) — agent-first integration guide with 3 paths (MCP, free key, x402)
- `/openapi` page — interactive Scalar API reference (try-it-out, codegen)
- 6 JSON-LD schemas at the layout level (SoftwareApplication, Organization, FAQPage, HowTo, BreadcrumbList, WebAPI) for richer agent + SEO discovery
- Design tokens ported from the previous Vite version: `--ink-0..5`, `--fg-1..5`, `--amber-50..700`, `--swiss-500/600`, `--risk-{low,med,high}`, `--syn-*`, `pulse-live` and `blink` animations, `.eyebrow`, `.kv-grid`, `.endpoint-row`, `.tnum`, `.tracking-caps` utility classes
- Reusable components: `StatusDot`, `RiskChip`, `EndpointRow`, `ApiKeyDialog` with provider
- Per-locale `<title>`, `<meta description>`, `<html lang>`, `hreflang` alternates (EN/FR/DE)
- Compliance-bundle endpoint `POST /v1/iban/compliance` ($0.02) advertised in pricing, calculator, landing
- 5th endpoint `GET /v1/ch/clearing/:iid` ($0.003) advertised in pricing, calculator, landing
- Persistent volume declaration in `railway.toml` for `stats.sqlite` (clés API, quotas, revenue)
- WAL mode + busy_timeout + 5 missing indices on `stats.sqlite` for concurrent throughput
- Permissions-Policy header denies camera/microphone/geolocation/payment/usb
- Content-Security-Policy on HTML responses (landing, MCP card)
- `IBANFORGE_FREE_MODE` env flag for explicit production free mode (loud warning)

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
