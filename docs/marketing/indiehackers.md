# IndieHackers Post

## Title

I built a fintech API with $6/month infrastructure -- here's how

## Post

Hey IH!

I just launched IBANforge -- a free API for IBAN validation and BIC/SWIFT lookup. Here's the backstory and numbers.

**The problem:** Every IBAN/BIC API either costs $500+/year or has terrible documentation. AI agents can't use any of them.

**The solution:** IBANforge -- free API, MIT license, MCP integration for AI agents, 121K+ BIC entries (38K LEI-enriched via GLEIF) from open data.

**Infrastructure costs:**

- Railway (API hosting): $5/month
- Vercel (frontend): $0/month (hobby plan)
- Domain: ~$1/month
- Data (GLEIF): free (CC0 license)
- Total: ~$6/month

**What's included:**

- IBAN validation for 84 countries
- BIC/SWIFT lookup with bank names, LEI
- Swiss clearing: 1,190 BC-Nummer entries from SIX (SIC, euroSIC, Instant Payments, QR-IID)
- 85 EMI/neobank classifications for vIBAN detection
- 5 MCP tools for AI agents (validate, batch, BIC lookup, compliance, Swiss clearing)
- Interactive playground
- Full API docs
- OpenAPI spec

**Business model (future):**

- x402 micropayments: $0.005/IBAN validation
- Target: $3K MRR at 12 months

**Tech stack:** Hono + TypeScript + SQLite (API), Next.js + shadcn (frontend)

Everything is open source: https://github.com/cammac-creator/ibanforge

Would love your feedback -- especially on pricing and go-to-market strategy.
