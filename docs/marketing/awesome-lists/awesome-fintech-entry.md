# Entries for awesome-fintech lists

## 1. moov-io/awesome-fintech (279 stars)

**Repository:** https://github.com/moov-io/awesome-fintech  
**Category:** Banking / Account Validation  
**Status:** Ready to submit PR

### How to Contribute

1. Fork https://github.com/moov-io/awesome-fintech
2. Edit `README.md`
3. Find the **Banking** section or closest relevant section
4. Add the entry in alphabetical order
5. Submit a Pull Request

### Where to Add

The repo covers financial libraries and tools. IBANforge fits best under a new subsection or an existing one. Based on the README structure, add under **Compliance** or create a new **Account Validation** subsection:

**Option A — Under existing relevant section (Banking / Compliance):**

```markdown
- [IBANforge](https://github.com/cammac-creator/ibanforge) - REST API and MCP server for IBAN validation (80+ countries, mod-97 checksum) and BIC/SWIFT lookup (39K+ entries from GLEIF). x402 micropayments, self-hostable via Docker.
```

**Option B — Propose a new subsection:**

```markdown
## Account Validation

- [IBANforge](https://github.com/cammac-creator/ibanforge) - REST API and MCP server for IBAN validation (80+ countries, mod-97 checksum) and BIC/SWIFT lookup (39K+ entries from GLEIF). x402 micropayments, self-hostable via Docker.
```

---

## 2. 7kfpun/awesome-fintech (347 stars)

**Repository:** https://github.com/7kfpun/awesome-fintech  
**Category:** APIs (or new IBAN/Banking Data section)  
**Status:** Ready to submit PR

### How to Contribute

1. Fork https://github.com/7kfpun/awesome-fintech
2. Edit `README.md`
3. Find or create an **APIs** section
4. Add the entry in alphabetical order

### Entry to Add

The repo uses a `* [Name](url) - description` format with language subsections. Add under a general APIs section or create one:

```markdown
## APIs

### Banking & Account Validation
* [IBANforge](https://ibanforge.com) - IBAN validation API and MCP server for 80+ countries with BIC/SWIFT lookup (39K+ entries). Pay-per-call x402 micropayments or self-host.
```

---

## Notes

- IBANforge GitHub: https://github.com/cammac-creator/ibanforge
- API endpoint: https://api.ibanforge.com
- Docs: https://ibanforge.com/docs
- Self-hostable: yes, via Docker (`docker pull ghcr.io/cammac-creator/ibanforge`)
- License: MIT
