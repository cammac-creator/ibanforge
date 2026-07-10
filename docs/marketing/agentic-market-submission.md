# agentic.market — Submission Pack

agentic.market is a **curated** showcase of x402-enabled APIs (50 services as of 2026-04-29), most of them clearly Coinbase Developer Platform partners. There is no public submission form; the listing process is via direct contact with the Coinbase CDP team.

This pack contains the materials to request a listing across three channels.

---

## Channel 1 — Coinbase Developer Platform Discord (primary)

**URL** : https://discord.gg/cdp

**Where to post** : the `#x402` channel (or whatever the current x402-related channel is — ask in `#general` if unsure).

**Message** :

```
Hi team — sharing IBANforge for agentic.market consideration.

IBANforge is an x402-native compliance API for AI finance agents. It's been
live on Base mainnet via the CDP facilitator for several weeks, with the full
Bazaar discovery extension and 5 paid endpoints. The angle that's not on
agentic.market today: a single call returns IBAN validity + BIC/SWIFT (121k+
BIC entries, 38k+ LEI-enriched via GLEIF) + Swiss BC-Nummer (~1,200 SIX entries
— the deepest Swiss clearing data in any public API) + sanctions/SEPA/VoP risk score + EMI/vIBAN
classification.

Agent-first details:
- Native MCP server (5 tools) — npm i ibanforge-mcp, also remote streamable-HTTP
- Free API key in 1 POST, 200 calls/month, no signup form
- Quota exhaustion auto-falls back to x402 (no dead-end for agents that scale)
- Coverage: 84 countries IBAN, 75 with bank-code mapping, full SEPA + EU VoP

Endpoints + pricing:
- POST /v1/iban/validate — $0.005
- POST /v1/iban/batch — $0.002/IBAN (max 100)
- GET  /v1/bic/{code} — $0.003
- GET  /v1/ch/clearing/{iid} — $0.003
- POST /v1/iban/compliance — $0.02

Site: https://ibanforge.com
Agent guide: https://ibanforge.com/en/agents
OpenAPI live: https://ibanforge.com/en/openapi
Discovery: https://api.ibanforge.com/.well-known/x402

Happy to add anything you need for the catalog. Thanks!
```

---

## Channel 2 — Twitter / X (signal boost + public visibility)

**Tag** : `@CoinbaseDev` (Coinbase Developer Platform official) and `@base` (Base L2).

**Tweet** :

```
Just shipped IBANforge v1.2 — agent-first IBAN/BIC/compliance API on x402 + Base.

5 endpoints, native MCP (5 tools), free API key (200/mo) that auto-falls
back to x402 — no dead-end when agents scale.

Our depth: full Swiss BC-Nummer coverage (~1,200 SIX entries, full rail participation + QR-IID) + compliance
bundle (sanctions + SEPA + VoP) in one call.

@CoinbaseDev would love a spot on agentic.market. Live on Bazaar discovery 🟢

🔗 https://ibanforge.com/agents
```

(Reply thread with /openapi link, MCP install snippet, and one IBAN→risk-score example response.)

---

## Channel 3 — Email / direct contact

If Discord and Twitter don't yield a response in 7-10 days, escalate via:

**Coinbase Developer Platform partnerships** — the CDP team has historically been reachable via cdp-support@coinbase.com or via the Coinbase Cloud GitHub Discussions (`https://github.com/coinbase/cdp-sdk/discussions`).

**Subject** : `IBANforge — x402 compliance API for agentic.market consideration`

**Body** :

```
Hi,

IBANforge (https://ibanforge.com) is an x402-native compliance API live on
Base mainnet via the CDP facilitator. We have 5 paid endpoints (IBAN validation,
batch, BIC/SWIFT lookup, Swiss BC-Nummer, compliance bundle) and a native
MCP server with 5 tools. We've been using x402 with the Bazaar discovery
extension since launch.

I'd like to be considered for agentic.market. We bring a niche that isn't
covered there yet: deep IBAN + BIC + compliance data for AI finance agents,
with the only Swiss BC-Nummer endpoint and a sanctions+SEPA+VoP risk score
in one call.

Quick stats:
- 121k+ BIC entries from public sources (GLEIF, SWIFT directory, Bundesbank, SIX, NBP, EBA Step2 SCT), 38k+ LEI-enriched via GLEIF
- ~1,200 SIX BankMaster entries (Swiss BC-Nummer with full rail participation + QR-IID — the deepest Swiss clearing data in any public API)
- 84 countries with IBAN coverage
- 5 MCP tools, free tier (200 req/mo) with x402 fallback when exhausted
- Trilingual site (EN/FR/DE), production-grade SEO

Discovery: https://api.ibanforge.com/.well-known/x402
OpenAPI: https://api.ibanforge.com/openapi.json
Agent guide: https://ibanforge.com/en/agents

Happy to provide anything else (logo, screenshots, sample 402 responses).
Looking forward.

— Alain Martin
   ibanforge.com / support@ibanforge.com
```

---

## Materials checklist

When the contact happens, have these ready:

- [x] Live x402 endpoints with Bazaar `extensions.bazaar.outputSchema` populated
- [x] Trust signals in 402 descriptions (production status, p99 latency, dataset size)
- [x] `.well-known/x402` valid + cacheable
- [x] `/agents` page (EN/FR/DE)
- [x] `/openapi` interactive reference (Scalar)
- [x] OpenAPI 3.1 JSON at `https://api.ibanforge.com/openapi.json`
- [x] MCP package on npm (`ibanforge-mcp@1.2.0`)
- [x] Free key endpoint (`POST /v1/keys/generate`)
- [x] CHANGELOG documenting agent-first features
- [x] GitHub release v1.2.0 tagged
- [ ] PNG logo 400×400 (already exists for marketplace badge)
- [ ] Screenshot of /agents page for the marketplace card

## Why agentic.market matters

The 50 services there get **organic agent traffic** because:
- LLM clients (Claude, GPT) increasingly query the agentic.market API for service discovery
- Coinbase x402 documentation prominently links to agentic.market
- The Coinbase Bazaar UI surfaces agentic.market services in search

A listing here = direct funnel from autonomous agents discovering financial APIs.

## Status tracking

| Channel | Sent | Response | Listed |
|---|---|---|---|
| Discord CDP `#x402` | (todo) | — | — |
| Twitter @CoinbaseDev | (todo) | — | — |
| Email cdp-support | (only if 7-10 days no response) | — | — |
| Bazaar (organic) | live since 2026-04-29 (4 settled txs) | — | check 2026-04-30 routine |

## Follow-ups

If no response within 14 days:
1. Increase x402 transaction volume on Base (organic indexing booster)
2. Get listed on PulseMCP / Cline / awesome-x402 first (social proof)
3. Build a public Show-and-Tell: a YouTube clip of an agent using IBANforge end-to-end via MCP and x402
