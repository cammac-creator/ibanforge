# awesome-fintech submission (→ awesome-quant)

**Cible :** [wilsonfreitas/awesome-quant](https://github.com/wilsonfreitas/awesome-quant) — **25.9K stars**, mis a jour aujourd'hui.
**Statut :** Pret a PR.

---

## Choix de la cible

Les 3 candidats du brief :
- `7kfpun/FinanceDatabase` → **404, n'existe pas** (le repo s'appelle plutot `JerBouma/FinanceDatabase`, et ce n'est pas une awesome-list).
- `popular-coding-resources/awesome-fintech` → **404, n'existe pas**.
- `wilsonfreitas/awesome-quant` → **25.9K stars, actif (push aujourd'hui)**.

→ Cible retenue : **`wilsonfreitas/awesome-quant`**.

C'est la awesome-list fintech la plus active sur GitHub. Pour completude, le brief mentionne aussi indirectement `moov-io/awesome-fintech` (279 stars) et `7kfpun/awesome-fintech` (347 stars) — deja prepares dans `awesome-fintech-entry.md` (existant). Ce fichier-ci traite specifiquement awesome-quant.

---

## Repo to fork

https://github.com/wilsonfreitas/awesome-quant

Branche par defaut : `main`
Fichier a editer : `README.md`

---

## Section to edit

Section : `## Market Data & Data Sources`.

Justification : IBAN / BIC / Swiss clearing sont des **financial reference data**, pas du trading ni de l'analytics. C'est exactement le type de datasets que cette section liste (sources de donnees financieres).

Position : a la fin de la section, en suivant le format de tag de langage existant.

---

## Entry to add

Format awesome-quant : `- [name](url) - \`Language\` - description.`

Ligne exacte a coller :

```markdown
- [IBANforge](https://github.com/cammac-creator/ibanforge) - `Python` - IBAN validation (89 countries, mod-97 + BBAN), BIC/SWIFT lookup (121k+ BIC entries from GLEIF, SWIFT directory, Bundesbank, SIX, NBP, EBA Step2 SCT — with LEI enrichment for the 39k+ GLEIF rows), Swiss BC-Nummer / IID lookup (1,100+ SIX BankMaster entries), and compliance/sanctions triage (OFAC, EU, UN, FATF, SEPA Instant, VoP). Python SDK (`pip install ibanforge`), MCP server, and REST API. Open-source (MIT) SDK + self-hostable Docker image; hosted endpoint with free tier + x402 pay-per-call.
```

---

## PR title

```
Add IBANforge — IBAN/BIC reference data + compliance triage (Python SDK)
```

---

## PR body

```markdown
Adds IBANforge under `## Market Data & Data Sources`.

IBANforge exposes financial reference data that is otherwise scattered across paywalled feeds or not available as an API at all:

- **IBAN validation** — 89 countries, mod-97 checksum + per-country BBAN structure
- **BIC/SWIFT** — 121k+ BIC entries from public sources (GLEIF, SWIFT directory, Bundesbank, SIX, NBP, EBA Step2 SCT), with LEI enrichment for the 39k+ GLEIF rows
- **Swiss BC-Nummer / IID** — 1,100+ entries from the SIX BankMaster dataset, including full SIC/euroSIC/instant participation, QR-IID allocations, and institution classification (the deepest Swiss clearing data in any public API, to my knowledge)
- **Compliance triage** — OFAC, EU, UN sanctions + FATF + SEPA Instant + VoP support + risk score 0–100, in a single call

Python usage:

```python
from ibanforge import IBANforge

client = IBANforge(api_key="ifk_...")
result = client.validate_iban("CH1000230000000012345")
```

The Python SDK and MCP server are MIT-licensed (https://github.com/cammac-creator/ibanforge), self-hostable via Docker. The hosted endpoint has a 200 req/month free tier and x402 micropayments (USDC on Base) for pay-per-call beyond the free tier.

PyPI: https://pypi.org/project/ibanforge/
Repo: https://github.com/cammac-creator/ibanforge
```

---

## Step-by-step (a faire demain matin par Alain)

1. **Fork** : https://github.com/wilsonfreitas/awesome-quant → clique `Fork` → fork sur `cammac-creator`.
2. **Edit** : sur ton fork, ouvre `README.md`, clique sur le crayon.
3. **Trouve** : Ctrl+F `## Market Data & Data Sources`. Descend a la **derniere ligne** de cette section (avant le `## ` suivant).
4. **Colle** la ligne du bloc "Entry to add" en nouvelle ligne, en respectant le format `- [name](url) - \`Python\` - description.`
5. **Commit** : message `Add IBANforge — IBAN/BIC reference data + compliance` sur nouvelle branche `add-ibanforge`.
6. **PR** : titre = bloc "PR title". Description = bloc "PR body". Submit.

---

## Notes

- Tag de langage : utiliser `Python` (le SDK PyPI est le canal principal pour les utilisateurs awesome-quant).
- Section choisie (`Market Data & Data Sources`) plutot que `Trading & Backtesting` ou `Sentiment Analysis & Alternative Data` : IBAN/BIC sont du master data financier, pas du trading.
- Si le mainteneur preconise `Cross-Language Frameworks` (l'API REST fonctionne avec n'importe quel langage), on peut accepter sans probleme.
- 25.9K stars : le mainteneur est selectif, la PR doit etre soigneusement formattee. Pas de fote de frappe, pas de promo agressive dans le body.
