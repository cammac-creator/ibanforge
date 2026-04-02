# Entry for punkpeye/awesome-mcp-servers

**Repository:** https://github.com/punkpeye/awesome-mcp-servers  
**Stars:** 40K+  
**Category:** Finance & Fintech  
**Status:** Ready to submit PR

## How to Contribute

1. Fork https://github.com/punkpeye/awesome-mcp-servers
2. Edit `README.md`
3. Find the **Finance & Fintech** section (search for `### 💰`)
4. Add the entry below in **alphabetical order** (under entries starting with 'H', before 'I' entries after IBANforge)
5. Submit a Pull Request

## Exact Line to Add

The Finance & Fintech section format is:

```markdown
### 💰 <a name="finance--fintech"></a>Finance & Fintech

- [author/repo](https://github.com/author/repo) 📇 ☁️ - Description of the MCP server.
```

**Emoji legend used in punkpeye/awesome-mcp-servers:**
- 📇 = TypeScript/JavaScript
- ☁️ = Cloud (remote API)
- 🏠 = Local (runs locally)
- 🍎 = macOS
- 🪟 = Windows
- 🐧 = Linux

**Entry to insert (alphabetical order — after 'h' entries, before other 'i' entries):**

```markdown
- [cammac-creator/ibanforge](https://github.com/cammac-creator/ibanforge) 📇 ☁️ 🏠 🍎 🪟 🐧 - IBAN validation and BIC/SWIFT lookup MCP server with 3 tools: `validate_iban`, `lookup_bic`, `batch_validate`. Covers 80+ countries, 39K+ bank entries from GLEIF. Pay-per-call via x402 micropayments (USDC) or self-host with Docker. [ibanforge.com](https://ibanforge.com)
```

## Alternative entry (shorter format)

Some entries in the list are more concise:

```markdown
- [cammac-creator/ibanforge](https://github.com/cammac-creator/ibanforge) 📇 ☁️ - IBAN validation & BIC/SWIFT lookup for 80+ countries. 3 MCP tools, 39K+ bank entries, x402 micropayments.
```

## Notes

- The MCP server is documented at: https://ibanforge.com/docs/mcp
- smithery.yaml is present in the repo for Smithery registry compatibility
- Tools exposed: `validate_iban`, `lookup_bic`, `batch_validate`
- Transport: stdio and HTTP/SSE
- Self-hostable via Docker
