# awesome-crewai submission

**Cible :** [crewAIInc/awesome-crewai](https://github.com/crewAIInc/awesome-crewai) — 488 stars, repo officiel CrewAI.
**Statut :** Risque de rejet — lire la note d'eligibilite ci-dessous AVANT de PR.

---

## Note d'eligibilite (IMPORTANT)

Les guidelines du repo (lues le 2026-04-29) listent explicitement comme **ineligible** :

> Commercial services or products.
> Company-led or proprietary projects.
> Projects with a primary focus on promoting a business.

Et redirigent ces projets vers un **formulaire HubSpot** pour le site ecosystem CrewAI :
https://share.hsforms.com/1djCk-vLCSLmtOd9M4KECZgr87kg

L'API hostee `api.ibanforge.com` est commerciale. **Le PR direct sera probablement ferme.**

### Deux strategies possibles

**Strategie 1 (recommandee) — Formulaire HubSpot.**
Remplis le formulaire ecosystem CrewAI ci-dessus. Plus aligne avec leurs regles. Pas de PR.

**Strategie 2 — PR positionne 100% open-source.**
Tu PR seulement le SDK Python + MCP server (MIT, github.com/cammac-creator/ibanforge), sans aucun lien vers ibanforge.com ou la pricing page. Risque de rejet quand meme. Tente si tu veux la visibilite GitHub.

Ce fichier prepare la **Strategie 2** (PR), mais commence par envoyer le formulaire HubSpot demain matin (Strategie 1) — les 2 sont complementaires.

---

## Repo to fork

https://github.com/crewAIInc/awesome-crewai

Branche par defaut : `main`
Fichier a editer : `README.md`

---

## Section to edit

Section : `## Projects` → sous-section `### Integrations`.

C'est un tableau Markdown (3 colonnes : Title | Description | Author). Voir les entrees existantes : "CrewAI + GMail + Coinbase + Stripe Integration", "CrewAI + OpenCommerce Integration".

Ajouter une **nouvelle ligne a la fin** du tableau `### Integrations`.

---

## Entry to add

Format exact (table row) :

```markdown
| [IBANforge MCP](https://github.com/cammac-creator/ibanforge) | Open-source MCP server + Python SDK (`pip install ibanforge`, MIT) exposing 5 tools for CrewAI agents handling banking data: validate IBAN (84 countries), look up BIC/SWIFT (121K+ GLEIF entries), Swiss clearing (1,190 SIX entries), and compliance triage (OFAC/EU/UN sanctions + FATF + VoP + risk score in one call). | [@cammac-creator](https://github.com/cammac-creator) |
```

Important : **ne mets PAS** de lien vers ibanforge.com / pricing / api.ibanforge.com dans la cellule. Lien repo GitHub uniquement.

---

## PR title

```
Add IBANforge MCP — IBAN/BIC validation + compliance integration for CrewAI agents
```

---

## PR body

```markdown
Adds IBANforge MCP to `### Integrations`.

IBANforge is an open-source (MIT) MCP server + Python SDK that gives CrewAI agents 5 banking-data tools:

- `validate_iban` — mod-97 + BBAN structure, 84 countries
- `batch_validate_iban` — up to 100 IBANs per call
- `lookup_bic` — 121,197 BIC entries from GLEIF, LEI-enriched
- `lookup_ch_clearing` — 1,190 Swiss BC-Nummer / IID entries from SIX BankMaster (dataset not exposed as an API anywhere else)
- `check_compliance` — OFAC, EU, UN sanctions, FATF, SEPA Instant, VoP, risk score 0–100, in a single tool call

Use case: a CrewAI agent that pre-flights a SEPA payment runs `validate_iban` → `check_compliance` before triggering the bank API. The compliance bundle replaces ~4 separate API calls.

Repo: https://github.com/cammac-creator/ibanforge
PyPI: https://pypi.org/project/ibanforge/
npm (MCP): https://www.npmjs.com/package/ibanforge-mcp

The package is MIT-licensed and works against either a self-hosted instance or a hosted endpoint with a free tier (200 req/month, no signup form).
```

---

## Step-by-step (Strategie 2 / PR)

1. **Lire d'abord la note d'eligibilite** ci-dessus. Decider si tu veux tenter le PR ou ne faire que le formulaire HubSpot.
2. Si tu tentes le PR :
   1. **Fork** : https://github.com/crewAIInc/awesome-crewai → Fork.
   2. **Edit** : ouvre `README.md`, clique sur le crayon.
   3. **Trouve** : Ctrl+F `### Integrations`. Descend a la **derniere ligne** du tableau (avant `---`).
   4. **Colle** la ligne du tableau (bloc "Entry to add").
   5. **Commit** : `Add IBANforge MCP integration` sur une nouvelle branche `add-ibanforge-mcp`.
   6. **PR** : titre + body des blocs ci-dessus. Submit.
3. **En parallele** (recommande quoi qu'il arrive) : remplis le formulaire HubSpot https://share.hsforms.com/1djCk-vLCSLmtOd9M4KECZgr87kg pour le ecosystem page.

---

## Notes

- Si le PR est ferme avec un commentaire "commercial product, fill the form", c'est attendu. Pas grave, le formulaire est la voie officielle.
- Le formulaire prend ~5 min aussi. Faire les deux.
