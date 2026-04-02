# Twitter/X Thread

## Tweet 1 -- Announcement

I just launched IBANforge -- a free API for IBAN validation and BIC/SWIFT lookup.

80+ countries. 39K+ BIC entries. MCP integration for AI agents.

Free during launch. No API key. No signup.

Here's the story (thread)

https://ibanforge.com

## Tweet 2 -- The Problem

Every IBAN/BIC API I found was either:

- $500+/year for basic validation
- Poorly documented (good luck finding a curl example)
- Zero support for AI agents

I needed something simple: send an IBAN, get back validation + bank details. So I built it.

## Tweet 3 -- What Makes It Different

What makes IBANforge different:

- MCP integration -- AI agents (Claude, GPT, Cursor) can discover and use it natively
- Open data -- 39K BIC entries from GLEIF (CC0 license)
- Self-hostable -- MIT license, Docker, SQLite
- x402 micropayments -- pay $0.005/call, no subscription

## Tweet 4 -- The Tech Stack

Tech stack:

API: Hono + TypeScript + SQLite (better-sqlite3)
Frontend: Next.js + shadcn/ui
Payments: x402 (HTTP 402 + USDC on Base)
AI: MCP SDK (Model Context Protocol)
Deploy: Docker on Railway + Vercel

SQLite queries run in <10ms. The entire BIC database is a single file shipped in the Docker image.

## Tweet 5 -- The Numbers

Running costs:

Railway (API): $5/mo
Vercel (frontend): $0/mo
Domain: ~$1/mo
GLEIF data: free

Total: ~$6/month

No managed database. No Redis. No third-party API dependencies.

Sometimes the simplest architecture is the best one.

## Tweet 6 -- Try It Now

Want to try it? No signup needed.

Interactive playground:
https://ibanforge.com/playground

API docs with curl/Python/TS examples:
https://ibanforge.com/docs

Or just curl it:
curl -X POST https://api.ibanforge.com/v1/iban/validate \
  -H "Content-Type: application/json" \
  -d '{"iban": "CH93 0076 2011 6238 5295 7"}'

## Tweet 7 -- What's Next + CTA

What's next:

- Activate x402 micropayments
- Add SEPA reachability data
- Python and TypeScript SDKs
- More BIC data sources

If you're building payment tools, AI agents, or fintech products -- I'd love your feedback.

Star the repo: https://github.com/cammac-creator/ibanforge

Built solo from Switzerland. DMs open.
