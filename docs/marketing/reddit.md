# Reddit Posts

## r/webdev

**Title:** I built a free IBAN validation API -- would love feedback

I just shipped IBANforge, a free IBAN validation and BIC/SWIFT lookup API. It validates IBANs for 80+ countries with full BBAN parsing (bank code, branch, account number) and auto-resolves the BIC/SWIFT code.

Built with Hono + TypeScript + SQLite. 39K+ BIC entries from GLEIF open data. Also has MCP integration so AI agents can use it natively.

Free during launch, no API key needed. Interactive playground if you want to try it without writing code.

Playground: https://ibanforge.com/playground
Docs: https://ibanforge.com/docs
GitHub: https://github.com/cammac-creator/ibanforge

Would love feedback on the API design and documentation. What would make this more useful for your projects?

---

## r/node

**Title:** Built a Hono API with SQLite for BIC/SWIFT lookup -- 39K entries, <10ms queries

Sharing a project I just finished: IBANforge, an IBAN validation + BIC lookup API built with Hono and SQLite (better-sqlite3).

The BIC database has 39K entries from GLEIF, stored in a single SQLite file shipped inside the Docker image. Queries run in <10ms with prepared statements and an LRU cache on top. No PostgreSQL, no connection pools, no managed DB costs.

The whole thing runs on $5/month on Railway. TypeScript throughout, vitest for testing, x402 middleware for future micropayments.

Stack: Hono + better-sqlite3 + zod + MCP SDK

Source: https://github.com/cammac-creator/ibanforge
Try it: https://ibanforge.com/playground

Curious what you think of the architecture. Any suggestions for improving query performance or caching strategy?

---

## r/fintech

**Title:** Free IBAN/BIC API for developers -- open data, MCP integration

I launched IBANforge, a free API for IBAN validation and BIC/SWIFT code lookup. Built it because every existing solution is either overpriced ($500+/year) or poorly documented.

What it does: validates IBANs for 80+ countries, looks up BIC/SWIFT codes from a 39K entry database (GLEIF, CC0 license), returns bank name, LEI, country. Also has batch validation for up to 100 IBANs per call.

The differentiator: it has MCP (Model Context Protocol) integration, meaning AI agents like Claude can use it natively for payment verification, KYC workflows, and invoice processing.

Free during launch, MIT license, self-hostable with Docker.

Playground: https://ibanforge.com/playground
Docs: https://ibanforge.com/docs

If you work in payments or compliance, I'd especially appreciate feedback on what data points are most useful.

---

## r/sideproject

**Title:** My $6/month fintech API side project

Just launched IBANforge -- an API that validates IBANs and looks up BIC/SWIFT codes. Solo project, built from Switzerland.

Infrastructure costs:
- Railway hosting: $5/month
- Vercel frontend: $0
- Domain: ~$1/month
- Data source (GLEIF): free

What it does: validates IBANs for 80+ countries, resolves BIC/SWIFT codes with bank names and LEI data, has an interactive playground, full API docs, and MCP support for AI agents.

The plan is to add x402 micropayments ($0.005/call) and target $3K MRR within 12 months. Everything is open source and self-hostable.

Try the playground: https://ibanforge.com/playground
GitHub: https://github.com/cammac-creator/ibanforge

What do you think about the pricing model? Micropayments vs traditional subscription?
