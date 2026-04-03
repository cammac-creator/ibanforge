# Product Hunt Launch

## Tagline (60 chars max)

Free IBAN validation & BIC lookup API for AI agents

## Description

IBANforge validates IBANs and looks up BIC/SWIFT codes for 75+ countries, with SEPA compliance data, issuer classification (bank vs EMI/neobank), and risk indicators. Built for developers and AI agents.

- 39,000+ BIC entries from GLEIF (open data)
- SEPA membership, payment schemes, and VoP requirement per country
- Issuer classification: detects Revolut, Wise, N26, etc. for vIBAN detection
- Risk indicators: country risk (FATF), SEPA reachability, VoP coverage
- MCP integration for Claude, GPT, and other AI agents
- Free during beta -- no API key, no subscription
- Interactive playground to test instantly
- Self-hostable (MIT license, Docker)

Perfect for: payment processing, KYC/AML compliance, invoice automation, vIBAN detection, and AI agent workflows.

## Maker Comment

Hey Product Hunt!

I'm a solo developer from Switzerland. I built IBANforge because I was frustrated with the existing IBAN/BIC APIs -- they're either too expensive, poorly documented, or completely inaccessible to AI agents.

IBANforge is free during beta (x402 micropayments are implemented and will activate at $0.002-$0.005/call), self-hostable, and has native AI agent support via MCP. It's also the only affordable API with SEPA compliance data and issuer classification for vIBAN detection.

I'd love your feedback on the API, the documentation, and what features you'd want next. Thanks for checking it out!

## Links

- Website: https://ibanforge.com
- Playground: https://ibanforge.com/playground
- API Docs: https://ibanforge.com/docs
- GitHub: https://github.com/cammac-creator/ibanforge

## Topics

- Developer Tools
- Artificial Intelligence
- Open Source
- Fintech
- APIs

## Media

- Logo: use IBANforge logo
- Gallery: screenshots of playground, API docs, MCP integration
- Video: (optional) 60s demo of playground + curl commands
