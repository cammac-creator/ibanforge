# awesome-langchain submission

**Cible :** [kyrolabs/awesome-langchain](https://github.com/kyrolabs/awesome-langchain) — 9.3K stars, actif (mis a jour aujourd'hui).
**Statut :** Pret a PR.

---

## Repo to fork

https://github.com/kyrolabs/awesome-langchain

Branche par defaut : `main`
Fichier a editer : `README.md`

---

## Section to edit

Section : `## Tools` → sous-section `### Agents`.

Position exacte : **a la fin** de la sous-section `### Agents` (les contribution guidelines imposent : `place it at the bottom of the list`).

Reperer la sous-section en cherchant `### Agents` dans le README. CrewAI, AgentGPT, GPT Researcher sont deja listes dans cette section — IBANforge MCP s'y inscrit comme outil d'agent.

---

## Entry to add

Format awesome-langchain : `- [Name](url): description ![GitHub Repo stars](https://img.shields.io/github/stars/USER/REPO?style=social)`

Ligne exacte a coller (a la toute fin de `### Agents`) :

```markdown
- [IBANforge](https://github.com/cammac-creator/ibanforge): MCP server + Python SDK (`pip install ibanforge`) for IBAN validation, BIC/SWIFT lookup (121k+ BIC entries, 38k+ LEI-enriched via GLEIF), Swiss BC-Nummer (~1,200 SIX entries), and compliance triage (OFAC/EU/UN sanctions, FATF, VoP, risk score). Lets LangChain agents validate bank accounts and pre-flight SEPA payments. Pay-per-call x402/USDC or self-host. ![GitHub Repo stars](https://img.shields.io/github/stars/cammac-creator/ibanforge?style=social)
```

---

## PR title

```
Add IBANforge — IBAN/BIC/SWIFT validation + compliance API for LangChain agents
```

---

## PR body

```markdown
Adds IBANforge to the `### Agents` section.

IBANforge is an open-source MCP server and Python SDK (MIT, https://pypi.org/project/ibanforge/) that exposes 5 tools for LangChain agents that touch banking data:

- `validate_iban` — mod-97 + BBAN structure check, 84 countries
- `batch_validate_iban` — up to 100 IBANs in one call
- `lookup_bic` — 121k+ BIC entries from public sources (GLEIF, SWIFT directory, Bundesbank, SIX, NBP, EBA Step2 SCT), with LEI enrichment for the 38k+ GLEIF rows
- `lookup_ch_clearing` — ~1,200 Swiss BC-Nummer / IID entries from SIX BankMaster (full payment-rail participation + QR-IID — the deepest Swiss clearing data in any public API)
- `check_compliance` — OFAC / EU / UN sanctions, FATF, SEPA Instant, VoP support, risk score 0–100, in a single call

Typical use case: an agent that drafts a SEPA payment runs `validate_iban` then `check_compliance` before sending. The compliance bundle is a single tool call instead of stitching 4 separate APIs.

The hosted API uses x402 micropayments (USDC on Base) with a 200 req/month free tier (key `ifk_`) and automatic fallback to pay-per-call. The MCP server and SDK are MIT-licensed and self-hostable via Docker — no signup required.

Demo + docs: https://ibanforge.com/agents
Repo: https://github.com/cammac-creator/ibanforge

Eligibility: open source (MIT), maintained, English, agent-related, adds value not present in the list (no IBAN/SEPA validation tool currently listed).
```

---

## Step-by-step (a faire demain matin par Alain)

1. **Fork** : ouvre https://github.com/kyrolabs/awesome-langchain et clique `Fork` (en haut a droite) → fork sur ton compte `cammac-creator`.
2. **Edit** : sur ton fork, ouvre `README.md`, clique sur l'icone crayon (Edit this file).
3. **Trouve** : Ctrl+F `### Agents` (sous `## Tools`). Descend jusqu'a la **derniere ligne** de cette sous-section.
4. **Colle** la ligne du bloc "Entry to add" (ci-dessus) en nouvelle ligne, juste avant la sous-section suivante.
5. **Commit** : message `Add IBANforge — IBAN/BIC validation + compliance for agents`. Coche `Create a new branch` → ex `add-ibanforge`.
6. **PR** : clique `Create pull request`. Titre = bloc "PR title". Description = bloc "PR body". Submit.
7. **Verifie** que tu n'as pas ajoute de ligne ailleurs (le linter du repo refuse les PR mal places).

---

## Notes

- Les guidelines ([contributing.md](https://github.com/kyrolabs/awesome-langchain/blob/main/contributing.md)) imposent : open source, maintenu, en anglais, place en bas de section. Toutes les conditions sont respectees.
- Les PR mal places sont fermees automatiquement. Verifie 2 fois la sous-section.
- Si le mainteneur demande un raccourcissement, version courte de l'entry :
  ```markdown
  - [IBANforge](https://github.com/cammac-creator/ibanforge): MCP server + Python SDK for IBAN validation, BIC/SWIFT lookup (121K+ BIC entries, 38K LEI-enriched via GLEIF), Swiss clearing data, and compliance/sanctions triage. Pay-per-call x402 or self-host.
  ```
