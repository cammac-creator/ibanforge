# IBANforge Compliance Bundle — Design Spec

## Objectif

Ajouter un endpoint `POST /v1/iban/compliance` à $0.02/appel qui retourne en un seul call : validation IBAN complète + sanctions screening (country + bank), SEPA Instant reachability, VoP participant check, et risk score composite. Transformer IBANforge de "validateur IBAN commodity" en "infrastructure compliance paiements".

## Architecture

Nouvelle base SQLite `compliance.sqlite` (read-only au runtime), alimentée par un cron hebdomadaire. Trois tables de données compliance interrogées en parallèle avec la validation IBAN existante. Zéro dépendance runtime externe — tout est local.

## Données sources

### 1. OpenSanctions — sanctions screening bank-level

- **Source** : export bulk OpenSanctions (JSON lines, téléchargement gratuit)
- **Datasets** : `sanctions` (entités sanctionnées mondiales) + `iso9362_bic` (mapping BIC → entités)
- **Contenu** : ~35 000 entités sanctionnées, ~2 000 BICs associés
- **Tables** :
  - `sanctioned_entities` : bic8 TEXT, entity_name TEXT, source_list TEXT (OFAC/EU/UN), country_code TEXT, sanctioned_since TEXT
  - `sanctioned_countries` : country_code TEXT PK, sanction_type TEXT (comprehensive/sectoral/embargo), sources TEXT
- **Refresh** : hebdomadaire
- **Licence** : gratuit pour téléchargement bulk, usage commercial nécessite attribution

### 2. FATF — listes grises/noires

- **Source** : liste FATF des juridictions sous surveillance (mises à jour 3x/an)
- **Contenu** : ~25 pays grey list, ~3 pays black list
- **Table** : `fatf_countries` : country_code TEXT PK, status TEXT (member/grey/black), updated TEXT
- **Refresh** : hebdomadaire (changements rares, 3x/an)

### 3. EPC SEPA — reachability par scheme

- **Source** : registres des participants EPC (XML/CSV, gratuit, téléchargement public)
- **Datasets** : SCT Register, SDD Register, SCT Inst Register
- **Table** : `sepa_participants` : bic8 TEXT, scheme TEXT (SCT/SDD/SCT_INST), status TEXT (active/inactive), effective_date TEXT, PK (bic8, scheme)
- **Refresh** : hebdomadaire

### 4. EPC VoP — participant directory

- **Source** : EPC VoP Directory Service
- **Table** : `vop_participants` : bic8 TEXT PK, status TEXT (active/pending/inactive), effective_date TEXT
- **Refresh** : hebdomadaire

## Endpoint

### `POST /v1/iban/compliance`

**Request :**
```json
{ "iban": "DE89370400440532013000" }
```

**Response :**
```json
{
  "iban": "DE89370400440532013000",
  "valid": true,
  "country": { "code": "DE", "name": "Germany" },
  "check_digits": "89",
  "bban": { "bank_code": "37040044", "account_number": "0532013000" },
  "bic": { "code": "COBADEFF", "bank_name": "COMMERZBANK", "city": "Frankfurt" },
  "sepa": { "member": true, "schemes": ["SCT", "SDD", "SCT_INST"], "vop_required": true },
  "issuer": { "type": "bank", "name": "COMMERZBANK" },
  "risk_indicators": {
    "issuer_type": "bank",
    "country_risk": "standard",
    "test_bic": false,
    "sepa_reachable": true,
    "vop_coverage": true
  },
  "compliance": {
    "sanctions": {
      "country_sanctioned": false,
      "bank_sanctioned": false,
      "matched_lists": [],
      "fatf_status": "member"
    },
    "reachability": {
      "sepa_instant": true,
      "sct": true,
      "sdd": true
    },
    "vop": {
      "participant": true,
      "status": "active"
    },
    "risk_score": 8,
    "risk_level": "low",
    "flags": []
  },
  "cost_usdc": 0.02,
  "processing_ms": 12
}
```

### Exemples de réponses à risque élevé

**IBAN d'un EMI dans un pays grey list FATF :**
```json
{
  "compliance": {
    "sanctions": {
      "country_sanctioned": false,
      "bank_sanctioned": false,
      "matched_lists": [],
      "fatf_status": "grey_list"
    },
    "reachability": { "sepa_instant": false, "sct": true, "sdd": false },
    "vop": { "participant": false, "status": "not_found" },
    "risk_score": 45,
    "risk_level": "elevated",
    "flags": ["fatf_grey_list", "emi_issuer", "no_sepa_instant", "no_vop"]
  }
}
```

**IBAN d'une banque sanctionnée :**
```json
{
  "compliance": {
    "sanctions": {
      "country_sanctioned": true,
      "bank_sanctioned": true,
      "matched_lists": ["OFAC_SDN", "EU_SANCTIONS"],
      "fatf_status": "black_list"
    },
    "reachability": { "sepa_instant": false, "sct": false, "sdd": false },
    "vop": { "participant": false, "status": "not_found" },
    "risk_score": 95,
    "risk_level": "critical",
    "flags": ["sanctioned_country", "sanctioned_bank", "fatf_black_list", "no_sepa"]
  }
}
```

## Risk Score (0-100)

Score composite calculé de manière additive :

| Facteur | Points | Condition |
|---|---|---|
| Pays sanctionné (comprehensive) | +50 | sanctioned_countries.sanction_type = 'comprehensive' |
| Banque sanctionnée | +50 | BIC8 trouvé dans sanctioned_entities |
| Pays sanctionné (sectoral) | +30 | sanctioned_countries.sanction_type = 'sectoral' |
| FATF black list | +30 | fatf_countries.status = 'black' |
| FATF grey list | +20 | fatf_countries.status = 'grey' |
| Issuer type: payment_institution | +15 | issuer.type = 'payment_institution' |
| Country risk: high | +20 | risk_indicators.country_risk = 'high' |
| Country risk: elevated | +10 | risk_indicators.country_risk = 'elevated' |
| Issuer type: EMI | +10 | issuer.type = 'emi' |
| Test BIC | +30 | is_test_bic = true |
| SEPA Instant non-reachable | +5 | sepa_instant = false |
| VoP non-participant | +5 | vop.participant = false |
| FATF non-member | +10 | fatf_countries.status not in ('member') AND not grey/black |

Score cappé à 100. Risk levels :
- **low** : 0-19
- **medium** : 20-39
- **elevated** : 40-59
- **high** : 60-79
- **critical** : 80-100

### Flags

Tableau de strings descriptifs ajoutés quand une condition de risque est détectée. Exemples : `sanctioned_country`, `sanctioned_bank`, `fatf_grey_list`, `fatf_black_list`, `emi_issuer`, `payment_institution_issuer`, `no_sepa_instant`, `no_vop`, `test_bic`, `high_risk_country`.

## Cron de refresh

### Script `scripts/refresh-compliance.ts`

1. Crée un répertoire temp
2. Télécharge OpenSanctions bulk export (JSON lines) — dataset `sanctions` + `iso9362_bic`
3. Parse et extrait : BICs sanctionnés, pays sanctionnés, FATF status
4. Télécharge les registres EPC : SCT, SDD, SCT Inst, VoP participants (XML/CSV)
5. Parse les registres EPC et extrait les BIC8 participants par scheme
6. Crée `compliance.sqlite` dans le répertoire temp avec toutes les tables
7. Remplace `data/compliance.sqlite` atomiquement (rename)
8. Log le nombre d'entrées importées par table

### Exécution

- **Développement** : `npm run compliance:refresh`
- **Production** : GitHub Actions cron hebdomadaire (dimanche 3h UTC) qui exécute le script, commit `data/compliance.sqlite`, et push. Railway redéploie automatiquement.
- **Fallback** : si le cron échoue, les données existantes restent en place (read-only, jamais supprimées)

## MCP

Nouveau tool `compliance_check` dans `src/mcp/server.ts` :

```
Tool: compliance_check
Input: { iban: string }
Output: Même JSON que POST /v1/iban/compliance
Description: Validate an IBAN and return comprehensive compliance data including
sanctions screening (OFAC/EU/UN), SEPA Instant reachability, VoP participant
status, issuer classification, and a composite risk score (0-100).
Use this when you need to assess whether a payment to a given IBAN is safe
from a compliance perspective. Returns everything validate_iban returns,
plus a full compliance layer.
Cost: $0.02 USDC per call.
```

## Fichiers

### Nouveau
- `src/lib/compliance-db.ts` — connexion à compliance.sqlite, cached prepared statements
- `src/lib/compliance.ts` — fonctions : checkSanctions(countryCode, bic8), checkReachability(bic8), checkVop(bic8), calculateRiskScore(all inputs), buildComplianceResult()
- `src/routes/iban-compliance.ts` — route POST /v1/iban/compliance
- `src/types.ts` — types ComplianceResult, SanctionsCheck, ReachabilityCheck, VopCheck
- `scripts/refresh-compliance.ts` — script de refresh des datasets
- `data/compliance.sqlite` — base générée (tracked in git comme bic.sqlite)
- `.github/workflows/refresh-compliance.yml` — cron GitHub Actions

### Modifié
- `src/index.ts` — monter ibanCompliance route + x402 middleware
- `src/middleware/x402.ts` — ajouter pricing $0.02 pour POST /v1/iban/compliance
- `src/mcp/server.ts` — ajouter tool compliance_check
- `src/lib/stats.ts` — recordOperation accepte déjà 'iban_compliance' via OperationType
- `src/types.ts` — ajouter 'iban_compliance' à OperationType

## Pricing x402

| Endpoint | Prix USDC |
|---|---|
| POST /v1/iban/validate | $0.005 (inchangé) |
| POST /v1/iban/batch | $0.20 (inchangé) |
| GET /v1/bic/:code | $0.003 (inchangé) |
| **POST /v1/iban/compliance** | **$0.02** |

## Tests

- Tests unitaires pour checkSanctions, checkReachability, checkVop, calculateRiskScore
- Test avec IBAN d'un pays sanctionné (ex: IR, RU, KP)
- Test avec IBAN d'une banque sanctionnée
- Test avec IBAN standard (DE, CH, FR) — score bas
- Test avec IBAN d'un EMI — score moyen
- Test du endpoint HTTP (402 avec x402 enabled, 200 avec x402 disabled)
- Test du refresh script (mock downloads)

## Hors périmètre

- Pas de screening de noms/personnes physiques
- Pas de VoP execution (vérification nom ↔ IBAN)
- Pas de webhooks/monitoring continu
- Pas d'historique des changements de statut sanctions
- Pas de batch compliance (v2)
