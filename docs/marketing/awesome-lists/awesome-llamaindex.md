# awesome-llamaindex submission

**Cible :** Aucun "awesome-llamaindex" officiel n'existe (recherche GitHub effectuee, aucun resultat pertinent au-dela de listes LLaMA-le-modele). Deux candidats sont proposes ci-dessous, par ordre de pragmatisme.
**Statut :** A reflechir avant de PR — aucun n'est un "5-min PR" propre.

---

## Recommandation honnete

Pour LlamaIndex, **le canal officiel d'integration n'est pas un awesome-list**, c'est `llama-index-integrations/tools/` dans le monorepo `run-llama/llama_index`. Cela signifie creer un package Python (`llama-index-tools-ibanforge`) avec tests, ce qui n'est PAS un PR rapide. C'est un projet a part entiere (1-2 jours).

**Tu peux raisonnablement deprioriser ce slot** ou choisir entre :
- **Option A (rapide, faible reach)** : ajouter un commentaire dans le repo `run-llama/llama_index` Discussions section, ou dans une issue "Tools wanted".
- **Option B (lent, forte legitimite)** : creer le package `llama-index-tools-ibanforge` officiel.

Si tu insistes pour un PR rapide demain, Option A. Sinon, mets ce slot en backlog et fais le package serieusement plus tard.

---

## Option A — Discussion / community channel (5 min)

### Repo to fork

Pas de fork. Pas de PR. C'est une issue ou un comment.

### Where to post

https://github.com/run-llama/llama_index/discussions

Categorie : `Show and tell` ou `Ideas`.

### Title

```
Show and tell: IBANforge — Python tool for IBAN/BIC validation + compliance triage
```

### Body

```markdown
Sharing a tool I built that LlamaIndex agents may find useful when handling banking data.

**IBANforge** — IBAN validation, BIC/SWIFT lookup, and compliance triage (sanctions / FATF / VoP / risk score) exposed as both a Python SDK and an MCP server.

- `pip install ibanforge`
- 5 tools: `validate_iban`, `batch_validate_iban`, `lookup_bic`, `lookup_ch_clearing`, `check_compliance`
- Datasets: 121,197 BICs (GLEIF), 1,190 Swiss BC-Nummer (SIX BankMaster — not available elsewhere as an API)
- 200 req/month free tier (no signup form, just `ifk_` key) + x402 pay-per-call (USDC on Base) when quota exceeded
- Open source (MIT) for SDK + MCP, hosted API is commercial

Use case: a LlamaIndex agent that ingests a payment instruction PDF, validates the IBAN, looks up the BIC, and runs a sanctions check — all via callable tools.

Repo: https://github.com/cammac-creator/ibanforge
Docs: https://ibanforge.com/agents

Happy to package this as `llama-index-tools-ibanforge` if there's interest.
```

### Step-by-step (Option A)

1. Va sur https://github.com/run-llama/llama_index/discussions/new?category=show-and-tell
2. Colle le titre et le body ci-dessus.
3. Submit.

---

## Option B — LlamaHub integration package (1-2 jours, pas demain)

### Repo to fork

https://github.com/run-llama/llama_index

### What to build

Un package Python sous `llama-index-integrations/tools/llama-index-tools-ibanforge/` avec :
- Wrapper autour du SDK PyPI `ibanforge` v1.1.0
- Classes `IBANforgeToolSpec` exposant les 5 tools comme `FunctionTool` LlamaIndex
- Tests unitaires (pytest)
- README.md du package
- Conformite a la CONTRIBUTING.md de run-llama (uv, pre-commit, lint)

### PR title

```
Add llama-index-tools-ibanforge: IBAN/BIC validation + compliance tool spec
```

### Notes

Le contributing guide ([CONTRIBUTING.md](https://github.com/run-llama/llama_index/blob/main/CONTRIBUTING.md)) impose `uv`, pre-commit hooks, et tests. Compter une journee complete pour faire ca proprement. Il existe deja `llama-index-tools-bing-search`, `llama-index-tools-yahoo-finance`, etc. comme modeles.

---

## Recommandation finale

**Demain matin, fais juste Option A** (5 minutes). Mets Option B dans le backlog distribution comme "tache packaging" pour plus tard.

Ne fais PAS de PR sur les "fake awesome-llamaindex" repos trouves dans la recherche (tous < 50 stars, abandonnes, ou hors-sujet LLaMA-le-modele).
