# Show HN Post

## Title

Show HN: IBANforge -- Free IBAN validation API with SEPA compliance and risk indicators for AI agents

## First Comment (Story)

Hi HN,

I built IBANforge -- a free API for validating IBANs and looking up BIC/SWIFT codes, with built-in compliance data.

Why? I was building AI agents that needed to verify bank account details before processing payments. Every existing API either cost thousands/year (IBAN.com: ~$9,500/yr), required institutional access (Mastercard), or only did basic checksum validation (open source libs).

What makes it different:
- SEPA compliance data: membership, payment schemes (SCT/SDD/SCT_INST), VoP requirement per country
- Issuer classification: detects if the bank is a traditional bank, neobank, EMI (Wise, Revolut, N26...) -- useful for vIBAN detection under EU AML regulations
- Risk indicators: country risk (FATF-based), SEPA reachability, VoP coverage -- one object, five signals
- MCP server: AI agents can discover and use it natively (5 tools: validate_iban, batch_validate_iban, lookup_bic, check_compliance, lookup_ch_clearing)
- 121k+ BIC entries from public sources (GLEIF, SWIFT directory, Bundesbank, SIX, NBP, EBA Step2 SCT), with LEI enrichment for the 38k+ GLEIF rows (CC0 where applicable)
- 84 countries for IBAN validation with full BBAN parsing
- Multilingual: EN/FR/DE (docs, blog, UI)
- Swiss clearing data: ~1,200 BC-Nummer entries from SIX with SIC, euroSIC, Instant Payments, and QR-IID for CH/LI IBANs
- Self-hostable (MIT license, SQLite, Docker)

Free during beta -- no API key, no signup. Pay-per-call via x402 micropayments (USDC) when activated.

Try it: https://ibanforge.com/playground
API docs: https://ibanforge.com/docs
GitHub: https://github.com/cammac-creator/ibanforge

Tech stack: Hono + TypeScript + SQLite + Next.js 16 + next-intl

Built as a solo project from Switzerland. Happy to answer questions about the architecture, EU compliance landscape, or the x402 payment model.
