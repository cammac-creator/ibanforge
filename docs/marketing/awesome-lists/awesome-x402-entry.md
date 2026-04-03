# Entries for awesome-x402 lists

## 1. xpaysh/awesome-x402 (161 stars) — PRIMARY TARGET

**Repository:** https://github.com/xpaysh/awesome-x402  
**Category:** Production Implementations / Ecosystem Projects  
**Status:** Ready to submit PR

### How to Contribute

1. Fork https://github.com/xpaysh/awesome-x402
2. Edit `README.md`
3. Find the **🏭 Production Implementations** section
4. Add the entry under the relevant subsection

### Entry for "🌟 Ecosystem Projects" section

```markdown
- [IBANforge](https://ibanforge.com) - IBAN validation & BIC/SWIFT lookup API with x402 micropayments. Validate IBANs for 75+ countries, look up 39K+ bank BIC codes from GLEIF. Pay-per-call from $0.003 in USDC on Base. Also exposes an MCP server for AI agent integration. [GitHub](https://github.com/cammac-creator/ibanforge)
```

### Entry for "🏭 Production Implementations" section

```markdown
- [IBANforge](https://ibanforge.com) - Production IBAN validation and BIC/SWIFT lookup API. x402 pay-per-call micropayments from $0.003/request in USDC. 75+ countries, 39K+ GLEIF entries, MCP server included. Self-hostable via Docker.
```

### Entry for "🤖 AI Agent Integration" section

```markdown
- [IBANforge MCP Server](https://ibanforge.com/docs/mcp) - MCP server exposing `validate_iban`, `lookup_bic`, and `batch_validate` tools. AI agents can validate bank account numbers and look up BIC codes paying per-call with x402/USDC. [GitHub](https://github.com/cammac-creator/ibanforge)
```

---

## 2. Merit-Systems/awesome-x402 (115 stars) — SECONDARY TARGET

**Repository:** https://github.com/Merit-Systems/awesome-x402  
**Category:** Example Apps  
**Status:** Ready to submit PR

### How to Contribute

1. Fork https://github.com/Merit-Systems/awesome-x402
2. Edit `README.md`
3. Find the **Example Apps** section
4. Add the entry

### Entry to Add

```markdown
- [IBANforge](https://github.com/cammac-creator/ibanforge) - IBAN validation and BIC/SWIFT lookup REST API + MCP server with x402 micropayments. $0.002–$0.005/request in USDC on Base. 75+ countries, 39K+ GLEIF BIC entries.
```

---

## Notes

- x402 integration: uses `x402-express` middleware with Coinbase facilitator
- Payment amounts: $0.003 (BIC lookup), $0.005 (IBAN validate), $0.002/IBAN (batch)
- Network: Base mainnet (USDC)
- API: https://api.ibanforge.com
- Docs: https://ibanforge.com/docs
