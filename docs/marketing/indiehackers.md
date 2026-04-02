# IndieHackers Post

## Title

I built a fintech API with $6/month infrastructure -- here's how

## Post

Hey IH!

I just launched IBANforge -- a free API for IBAN validation and BIC/SWIFT lookup. Here's the backstory and numbers.

**The problem:** Every IBAN/BIC API either costs $500+/year or has terrible documentation. AI agents can't use any of them.

**The solution:** IBANforge -- free API, MIT license, MCP integration for AI agents, 39K+ BIC entries from open data.

**Infrastructure costs:**

- Railway (API hosting): $5/month
- Vercel (frontend): $0/month (hobby plan)
- Domain: ~$1/month
- Data (GLEIF): free (CC0 license)
- Total: ~$6/month

**What's included:**

- IBAN validation for 80+ countries
- BIC/SWIFT lookup with bank names, LEI
- Interactive playground
- Full API docs
- MCP server for AI agents
- OpenAPI spec

**Business model (future):**

- x402 micropayments: $0.005/IBAN validation
- Target: $3K MRR at 12 months

**Tech stack:** Hono + TypeScript + SQLite (API), Next.js + shadcn (frontend)

Everything is open source: https://github.com/cammac-creator/ibanforge

Would love your feedback -- especially on pricing and go-to-market strategy.
