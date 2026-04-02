# Show HN Post

## Title

Show HN: IBANforge -- Free IBAN validation and BIC lookup API with MCP for AI agents

## First Comment (Story)

Hi HN,

I built IBANforge -- a free API for validating IBANs and looking up BIC/SWIFT codes.

Why? I was building AI agents that needed to verify bank account details, and every existing API either required an expensive subscription, didn't support AI agent protocols, or had terrible documentation.

What makes it different:
- Free during launch (all endpoints open, no API key needed)
- MCP integration -- AI agents can discover and use it natively
- 39,000+ BIC entries from GLEIF (open data, CC0 license)
- 80+ countries for IBAN validation with full BBAN parsing
- Self-hostable (MIT license, SQLite, Docker)

Try it: https://ibanforge.com/playground
API docs: https://ibanforge.com/docs
GitHub: https://github.com/cammac-creator/ibanforge

Tech stack: Hono + TypeScript + SQLite + Next.js

Built as a solo project from Switzerland. Happy to answer questions about the architecture, data sources, or business model.
