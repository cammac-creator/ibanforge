# IBANforge — External Submissions Pack

Tout le matériel prêt-à-coller pour soumettre IBANforge sur 4 plateformes
(PulseMCP, Cline marketplace, awesome-x402-servers, agentic.market).

À la fin de ces 4 soumissions, IBANforge sera visible sur les principaux
points de découverte qu'utilisent les agents IA et les devs qui les intègrent.

---

## 1) PulseMCP — index communautaire MCP (10 min)

**URL de soumission** : https://www.pulsemcp.com/submit (chercher "Submit your MCP server")

**Champs à remplir** :

| Champ                        | Valeur                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------- |
| Server name                  | `IBANforge`                                                                       |
| Author / GitHub              | `cammac-creator`                                                                  |
| Repository URL               | `https://github.com/cammac-creator/ibanforge`                                     |
| npm package                  | `ibanforge-mcp`                                                                   |
| Install command              | `npx -y ibanforge-mcp`                                                            |
| Categories / Tags            | `finance`, `banking`, `compliance`, `iban`, `bic`, `sepa`, `x402`, `payments`     |
| Short description (1 line)   | `IBAN validation, BIC/SWIFT lookup, Swiss BC-Nummer, SEPA + VoP and compliance risk scoring for AI agents.` |

**Long description** (à coller dans le champ description) :

```
IBANforge is the official MCP server for the IBANforge compliance API, exposing 5 tools for AI agents:

- validate_iban — verify any European IBAN AND enrich it with BIC/SWIFT, country, EMI/vIBAN flag, SEPA reachability, VoP (Verification of Payee, EU 2024/886), risk score, and Swiss BC-Nummer for CH/LI accounts. ($0.005)
- batch_validate_iban — up to 100 IBANs in one call, ideal for CSV cleanup or payout list triage. ($0.002 per IBAN)
- lookup_bic — resolve a BIC/SWIFT code into bank name, country, city, LEI, address. Backed by 121,399 BIC entries (38,761 LEI-enriched via GLEIF). ($0.003)
- lookup_ch_clearing — resolve a Swiss BC-Nummer / IID into institution name, type, SIC, euroSIC, QR-IID. The only API exposing this data, backed by 1,190 SIX BankMaster entries. ($0.003)
- check_compliance — pre-flight risk triage before a SEPA payment: sanctions screening (OFAC/EU/UN), FATF jurisdictions, SEPA Instant reachability, VoP participant. Returns risk_score 0-100. ($0.02)

Two transports: stdio via npm (`npx -y ibanforge-mcp`) and Streamable HTTP (`https://api.ibanforge.com/mcp`). Free tier: 200 requests/month with an auto-generated API key (POST /v1/keys/generate). Beyond that, pay-per-call in USDC via x402 — no credit card, no signup, just a wallet on Base.
```

**Example queries** (si demandé) :

- "Validate IBAN CH9300762011623852957 and tell me if it is a vIBAN, EMI-issued, or sanctioned country."
- "Look up Swiss BC-Nummer 762."
- "Run a compliance check on IBAN GB29NWBK60161331926819 before I send a payment."

---

## 2) Cline MCP marketplace — PR GitHub (15 min)

**Repo** : https://github.com/cline/mcp-marketplace
**Action** : fork + add JSON entry + open PR

### Étapes

```bash
gh repo fork cline/mcp-marketplace --clone --remote
cd mcp-marketplace
git checkout -b add-ibanforge
```

Ouvre le `README.md` ou le fichier `mcp-servers.json` du repo (regarde la structure exacte au moment du PR — peut avoir évolué). Le format ressemble à :

```json
{
  "name": "IBANforge",
  "description": "IBAN validation, BIC/SWIFT lookup, Swiss BC-Nummer, SEPA + VoP and compliance risk scoring for AI agents. 121,399 BIC entries (38,761 LEI-enriched via GLEIF), 1,190 SIX BankMaster Swiss entries, x402 micropayments.",
  "github": "https://github.com/cammac-creator/ibanforge",
  "npm": "ibanforge-mcp",
  "command": "npx",
  "args": ["-y", "ibanforge-mcp"],
  "category": "finance",
  "tags": ["iban", "bic", "swift", "sepa", "compliance", "x402", "swiss-banking"],
  "homepage": "https://ibanforge.com",
  "icon": "https://ibanforge.com/favicon.ico",
  "remote": {
    "type": "streamable-http",
    "url": "https://api.ibanforge.com/mcp"
  }
}
```

```bash
git add . && git commit -m "Add IBANforge MCP server (compliance API for AI agents)"
git push -u origin add-ibanforge
gh pr create --title "Add IBANforge MCP server" --body "$(cat <<'EOF'
Adds [IBANforge](https://ibanforge.com), the official MCP server for the IBANforge compliance API.

**Highlights**

- 5 tools: validate_iban, batch_validate_iban, lookup_bic, lookup_ch_clearing, check_compliance
- Backed by 121,399 BIC entries (38,761 LEI-enriched via GLEIF + 81,642 SWIFT directory + 142 Bundesbank + 633 SIX + 201 EBA Step2 SCT + 19 NBP) and 1,190 SIX BankMaster Swiss BC-Nummern (the only API exposing this last dataset)
- Two transports: stdio via `npx -y ibanforge-mcp` AND Streamable HTTP at `https://api.ibanforge.com/mcp`
- x402 micropayments support — pay-per-call in USDC on Base, no API key needed
- Free tier: 200 req/month with API key (POST /v1/keys/generate)

**Resources**

- npm: https://www.npmjs.com/package/ibanforge-mcp
- MCP Registry: https://registry.modelcontextprotocol.io/v0/servers?search=ibanforge
- Server card: https://api.ibanforge.com/.well-known/mcp/server-card.json

Tested locally with Claude Desktop and Cline.
EOF
)"
```

---

## 3) awesome-x402-servers — PR GitHub (10 min)

**Repo** : https://github.com/a6b8/awesome-x402-servers
**Action** : fork + add row in the table + PR

### Étapes

```bash
gh repo fork a6b8/awesome-x402-servers --clone --remote
cd awesome-x402-servers
git checkout -b add-ibanforge
```

Ouvre `README.md`, trouve la table principale des serveurs x402. Ajoute une ligne (en respectant le format existant) — quelque chose comme :

```markdown
| [IBANforge](https://ibanforge.com) | Compliance API for AI agents — IBAN validation, BIC lookup, Swiss BC-Nummer (1,190 SIX entries), SEPA + VoP, risk scoring | $0.003–$0.02 / call | [/.well-known/x402](https://api.ibanforge.com/.well-known/x402) | Base | [GitHub](https://github.com/cammac-creator/ibanforge) |
```

(adapte aux colonnes effectivement présentes dans le README)

```bash
git add README.md && git commit -m "Add IBANforge — compliance API for AI agents"
git push -u origin add-ibanforge
gh pr create --title "Add IBANforge x402 server" --body "$(cat <<'EOF'
Adds **IBANforge**, an x402-native compliance API for AI agents.

- 5 paid endpoints exposed via x402 on Base (USDC): /v1/iban/validate ($0.005), /v1/iban/batch ($0.002/IBAN), /v1/bic/{code} ($0.003), /v1/ch/clearing/{iid} ($0.003), /v1/iban/compliance ($0.02)
- Discovery: https://api.ibanforge.com/.well-known/x402
- Bazaar extension declared on every paid route (inputSchema/outputSchema) so facilitators auto-catalog it
- Also ships an official MCP server (npm `ibanforge-mcp`, MCP registry v1.2.0)

Repo: https://github.com/cammac-creator/ibanforge
Live: https://ibanforge.com
EOF
)"
```

Note : il existe **plusieurs** repos awesome-x402 (xpaysh/awesome-x402, a6b8/awesome-x402-servers, et des forks). Le repo `a6b8/awesome-x402-servers` semble le plus actif. Le badge dans le README pointe déjà vers `xpaysh/awesome-x402` — vérifie la liste exhaustive en cherchant "awesome x402" sur GitHub avant de soumettre, et envoie un PR sur les 2 ou 3 plus actifs.

---

## 4) agentic.market (Coinbase) — pas de formulaire public (statut 2026-04-30)

**URL** : https://agentic.market/

**Conclusion après investigation 2026-04-30** : agentic.market n'a **aucune soumission directe** :

- Aucun bouton "Submit", aucun formulaire web, aucun repo GitHub public.
- Le catalogue `/v1/services` (https://api.agentic.market/v1/services) **pulle exclusivement depuis le Coinbase Bazaar** (`api.cdp.coinbase.com/platform/v2/x402/discovery/resources`) avec ~24h de lag.
- IBANforge n'apparaît **ni** dans agentic.market (search "ibanforge"/"iban" → 0 résultat IBANforge), **ni** dans le Bazaar Coinbase (vérifié sur 600+ resources).
- Concurrents déjà listés : orbisapi.com (15 endpoints IBAN/BIC, $0.001-0.004) et api.strale.io ($0.01).

**`.well-known/x402` IBANforge** : valide et live (https://api.ibanforge.com/.well-known/x402, retourne x402Version 1, 5 endpoints, pricing, payTo). Mais le facilitator CDP n'a pas encore enregistré IBANforge dans son flux de découverte.

**Actions à mener pour être listé** :

1. **Augmenter le volume de transactions x402 réelles** sur Base mainnet via le facilitator CDP (`https://x402.org/facilitator`) — le Bazaar indexe les ressources qui settlent des paiements observés par le facilitator. Les 4 transactions notées le 2026-04-29 ne suffisent visiblement pas encore.
2. **Demande directe à Coinbase CDP** via les 3 canaux préparés dans `docs/marketing/agentic-market-submission.md` :
   - Discord CDP `#x402` (channel principal, message prêt)
   - Twitter `@CoinbaseDev` + `@base` (tweet prêt)
   - Email `cdp-support@coinbase.com` (escalade après 7-10 jours)

**Champs préparés (pour réponse rapide à toute requête CDP)** :

| Champ                | Valeur                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| Service name         | IBANforge                                                                                       |
| Service URL          | https://api.ibanforge.com                                                                       |
| Discovery URL        | https://api.ibanforge.com/.well-known/x402                                                      |
| Category             | Finance / Compliance / Banking                                                                  |
| Wallet (payTo)       | `0xD13bD0A4120BA301125290e5cc0c7EFD4CB40a55`                                                    |
| Network              | Base (eip155:8453)                                                                              |
| Asset                | USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)                                             |
| MCP server (npm)     | `ibanforge-mcp`                                                                                 |

**Description** :

```
IBANforge is a compliance API for AI agents — IBAN validation (mod-97 + BBAN parsing), BIC/SWIFT resolution against 121,399 BIC entries (38,761 LEI-enriched via GLEIF; additional rows from SWIFT directory, Bundesbank, SIX, NBP, EBA Step2 SCT), Swiss BC-Nummer / QR-IID lookup against 1,190 SIX BankMaster entries (the only API exposing this), EMI/vIBAN issuer classification, SEPA Instant + VoP (EU 2024/886) reachability flag, and composite compliance risk scoring (OFAC/EU/UN sanctions + FATF). Pay per call in USDC via x402 ($0.003 to $0.02 per call) — no API key signup required. Also available as a native MCP server (npm `ibanforge-mcp`).
```

---

## After submission — track them

Add to the **roadmap memory** :

- [ ] PulseMCP — submitted on YYYY-MM-DD, awaiting review
- [ ] Cline marketplace — PR #__ on cline/mcp-marketplace
- [ ] awesome-x402-servers — PR #__ on a6b8/awesome-x402-servers (and any other awesome-x402 repos)
- [x] agentic.market — investigated 2026-04-30 : aucun submission form public ; agentic.market pull depuis le Bazaar Coinbase. IBANforge ni dans agentic.market ni dans le Bazaar (600+ resources scannées). Action restante : pousser via Discord CDP `#x402` + augmenter volume x402 sur Base.

Re-check 1 week later. If a submission is rejected, ask why (often a missing field or category). Resubmit.
