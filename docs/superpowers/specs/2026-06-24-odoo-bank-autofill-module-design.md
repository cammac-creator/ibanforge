# Spec — Module Odoo « IBANforge Bank Auto-fill » (MVP)

**Date** : 2026-06-24
**Statut** : design validé (approche A + build immédiat)
**Auteur** : Claude-Alain (via Claude Code)

---

## 1. Contexte & motivation

Premier utilisateur organique réel d'IBANforge, un acteur du secteur bancaire. Cas d'usage
déclaré : auto-remplissage de coordonnées bancaires dans Odoo à partir d'un IBAN, intégration
câblée par leurs soins.

Ce module n'est **pas** une demande explicite du client (son intégration directe lui suffit) :
c'est un **pari de distribution**. L'Odoo App Store touche des millions de PME **non-crypto** —
exactement le canal de découverte qui manque à IBANforge (historique documenté : « discovery
problem, 0 transaction organique externe »). Le module est **l'entonnoir** ; le revenu vient de
l'API (free tier → x402 / credits / Stripe), pas du module.

**Décisions actées** :
- Approche **A** — module **gratuit** (AGPL-3, repo public), funnel vers l'API.
- Cible **Odoo 18.0** (Community) en premier. Backport 17.0 possible ensuite.
- Build immédiat (ne pas attendre la réponse de l'intégrateur), en parallèle de la relance email.

## 2. Proposition de valeur (vs Odoo natif)

| Capacité | Odoo natif `base_iban` | OCA `base_bank_from_iban` | **Ce module** |
|---|---|---|---|
| Valide le format IBAN (mod-97) | ✅ (`@api.constrains`) | ✅ | délègue à `base_iban` |
| Remplit le **BIC** | ❌ | ❌ | ✅ via API |
| Remplit le **nom de banque** | ❌ | partiel (banque *déjà configurée à la main*) | ✅ via API (find-or-create) |
| Base BIC **mondiale** | ❌ | ❌ (mapping local manuel) | ✅ 121k+ BIC, 75 pays |
| SEPA / risque / clearing CH | ❌ | ❌ | ✅ (badge informatif) |

**Le trou** : `base_bank_from_iban` ne sait apparier une banque que si l'utilisateur l'a
*pré-configurée avec son code*. Personne ne configure 121 000 banques. IBANforge le fait en un
appel, sans config.

## 3. Périmètre

### MVP (in scope)
1. À la saisie d'un IBAN sur `res.partner.bank` : appel IBANforge `validate`.
2. Auto-remplissage **BIC + nom de banque** (find-or-create `res.bank`, lien via `bank_id`).
3. Indication de **validité** ; **warning non-bloquant** si IBAN invalide ou API indisponible.
4. Badge informatif optionnel **SEPA / risque pays** (toggle réglages).
5. Écran de **réglages** : clé API + base_url + toggle compliance + lien free tier.
6. Tests unitaires (HTTP mocké).
7. Page de présentation App Store (`static/description/index.html`) + icône + README + LICENSE.

### Out of scope (v2+)
- Compliance/sanctions complètes (`/v1/iban/compliance`) — MVP n'utilise que `validate`.
- Batch / enrichissement en masse des comptes existants.
- Backport multi-versions (17.0, 16.0).
- i18n FR/DE (EN d'abord ; structure i18n prête).
- Publication payante.

## 4. Contrat API consommé (vérifié live sur `/v1/demo`, 2026-06-24)

Endpoint : `POST {base_url}/v1/iban/validate`
Auth : header `X-API-Key: <clé free tier>` (ou clé payante). Body : `{"iban": "<IBAN>"}`.

Réponse **runtime réelle** (snake_case — le type TS fait foi ; l'`outputExample` x402 en
camelCase est divergent et ne doit PAS servir de référence) :

```json
{
  "valid": true,
  "iban": "DE89370400440532013000",
  "formatted": "DE89 3704 0044 0532 0130 00",
  "country": { "code": "DE", "name": "Germany" },
  "bic": { "code": "COBADEFF", "bank_name": "COMMERZBANK AG", "city": "Frankfurt am Main" },
  "sepa": { "member": true, "schemes": ["SCT","SDD","SCT_INST"], "vop_required": true },
  "issuer": { "type": "bank", "name": "COMMERZBANK AG" },
  "risk_indicators": { "issuer_type": "bank", "country_risk": "standard", "test_bic": false, "sepa_reachable": true, "vop_coverage": true },
  "clearing": null,
  "cost_usdc": 0.005
}
```

Champs consommés par le module :
- `valid` (bool) → validité.
- `bic.code` (string|null) → `bank_bic`.
- `bic.bank_name` (string|null) → nom `res.bank`.
- `sepa.member`, `risk_indicators.country_risk`, `clearing` (CH/LI) → badge informatif optionnel.

`bic` peut être `null` (IBAN valide mais BIC introuvable) → remplir validité sans toucher
`bank_id`. Un seul appel suffit (pas de second lookup BIC).

## 5. Modèle Odoo 18 (champs exacts, vérifiés sur `res_bank.py`@18.0)

`res.bank` : `name = Char(required=True)`, `bic = Char(index=True)`.
`res.partner.bank` :
- `acc_number = Char(required=True)` (contient l'IBAN)
- `acc_type` = Selection calculée (`'iban'` / `'bank'`)
- `bank_id = Many2one('res.bank')`
- `bank_name = Char(related='bank_id.name', readonly=False)`
- `bank_bic = Char(related='bank_id.bic', readonly=False)`

⇒ **Poser `bank_id`** suffit à remplir `bank_name` + `bank_bic` (champs related).

## 6. Architecture & fichiers

```
integrations/odoo/ibanforge_bank_autofill/
  __init__.py
  __manifest__.py                 # name "IBANforge Bank Auto-fill" (24 car. ≤25), AGPL-3,
                                  #   PAS de price (gratuit), depends: ['base', 'base_iban'],
                                  #   category 'Accounting', external_dependencies py ['requests']
  models/
    __init__.py
    res_partner_bank.py           # héritage ; onchange + create/write + helper _ibanforge_lookup
    res_config_settings.py        # clé API + base_url + toggle compliance (ir.config_parameter)
  views/
    res_config_settings_views.xml # bloc réglages (Settings) + lien "Get a free API key"
    res_partner_bank_views.xml    # surface validité + badge SEPA/risque (champs helper non stockés)
  i18n/                           # (vide au MVP, structure prête)
  static/description/
    index.html                    # page App Store (présentation + captures + valeur)
    icon.png                      # icône module
  tests/
    __init__.py
    test_autofill.py              # HTTP mocké (unittest.mock.patch sur requests)
  README.rst
  LICENSE                         # AGPL-3
```

## 7. Flux de données & logique

**Helper** `_ibanforge_lookup(self, iban) -> dict | None` (sur `res.partner.bank`) :
- lit clé API + base_url depuis `ir.config_parameter` ; si pas de clé → retourne `None` (no-op).
- `POST {base_url}/v1/iban/validate`, header `X-API-Key`, body `{"iban": iban}`, **timeout ~4 s**.
- toute exception réseau / status ≥400 → log debug + retourne `None` (jamais d'exception remontée).
- retourne le JSON parsé sinon.

**`@api.onchange('acc_number')`** (feedback instantané, **ne crée aucun enregistrement**) :
- si `acc_type != 'iban'` ou `acc_number` vide → ne rien faire.
- appel lookup ; si `data['valid'] == False` → `return {'warning': {...}}` (non bloquant).
- si `bic.code` présent : chercher un `res.bank` existant (`bic =ilike code`) ; si trouvé →
  `self.bank_id = bank` ; sinon → renseigner champs **helper non stockés**
  (`ibanforge_detected_bic`, `ibanforge_detected_bank_name`) pour affichage + message
  « banque créée à l'enregistrement ». (Pas de `create()` en onchange → zéro orphelin.)
- optionnel : remplir un champ helper badge (SEPA/risque) pour la vue.

**`create()` / `write()`** (autoritatif, persiste) :
- `super()` d'abord.
- pour chaque enregistrement dont `acc_type == 'iban'` et `acc_number` changé et `bank_id` non
  défini : appel lookup ; si `bic.code` → find-or-create `res.bank` (par `bic`, sinon
  `create({name: bank_name, bic: code})`) et set `bank_id`.
- ne jamais écraser un `bank_id` saisi manuellement par l'utilisateur.

**Idempotence / dédup** : find-or-create matche par `bic` (insensible casse). Si plusieurs
`res.bank` ont le même BIC, prendre le premier (`order id`).

## 8. Réglages (`res.config.settings`)

`ir.config_parameter` :
- `ibanforge.api_key` (Char, secret) — défaut vide.
- `ibanforge.base_url` (Char) — défaut `https://api.ibanforge.com`.
- `ibanforge.enable_risk_badge` (Boolean) — défaut `True`.

Vue réglages : champ clé API + base_url + toggle, et un lien
`https://ibanforge.com/?utm_source=odoo` / endpoint free-tier (`POST /v1/keys/generate`) pour
obtenir une clé 200/mois.

## 9. Gestion d'erreurs (principe directeur)

**Le module ne bloque JAMAIS la saisie/sauvegarde d'un compte bancaire.**
- API down / timeout / 401 / 402 / 5xx → no-op + warning informatif (onchange), pas d'exception.
- Pas de clé configurée → no-op silencieux (1er usage : message d'info via le badge/vue).
- IBAN invalide → la contrainte `base_iban` reste seule maîtresse du blocage à l'enregistrement ;
  l'onchange ajoute juste un warning anticipé.
- `requests` indisponible (jamais en pratique sur Odoo) → déclaré en `external_dependencies`.

## 10. Tests & vérification

- **Unitaires** (`tests/test_autofill.py`, `@tagged('post_install','-at_install')`),
  `requests.post` mocké :
  1. IBAN valide + `bic.code` → `bank_id` posé, `bank_bic`/`bank_name` corrects, `res.bank` créé.
  2. BIC déjà en base → réutilisé (pas de doublon).
  3. `bic == null` → validité OK, `bank_id` intact.
  4. `valid == false` → warning onchange, pas de blocage.
  5. Pas de clé API → no-op (aucun appel réseau).
  6. API timeout/erreur → no-op gracieux, sauvegarde réussie.
  7. `bank_id` saisi manuellement → non écrasé.
- **Statique** : `python -m py_compile` sur les .py ; XML bien formé ; manifest importable.
- **Runtime (optionnel, sur demande)** : smoke test Docker `odoo:18` + Postgres — installer le
  module, créer un `res.partner.bank` avec un IBAN, vérifier que le BIC se remplit.

## 11. Distribution & publication

- Vit d'abord dans `integrations/odoo/` du repo `ibanforge` (build + CI + tests).
- Pour l'App Store : extraire dans un **repo public dédié** `cammac-creator/ibanforge-odoo`,
  branche `18.0`, à la soumission. Manifest gratuit (AGPL-3, repo public OK).
- Page `static/description/index.html` : valeur, captures, lien API, mention free tier.
- Listing `apps.odoo.com/apps/upload` (catégorie Accounting). Nom ≤25 car.

## 12. Critères de succès

- Module **installable** sur Odoo 18 sans erreur ; tests verts.
- Sur saisie d'un IBAN réel (ex. `DE89370400440532013000`), `bank_bic` = `COBADEFF` et
  `bank_name` = `COMMERZBANK AG` se remplissent automatiquement.
- Aucun blocage de la sauvegarde en cas d'API indisponible.
- Prêt à soumettre à l'Odoo App Store (assets + description complets).

## 13. Risques / questions ouvertes

- **Demande réelle** : l'intégrateur pourrait répondre que l'API directe lui suffit → le module
  reste un pari distribution autonome (App Store), pas une dépendance à sa réponse.
- **Version Odoo de l'intégrateur** inconnue (18 ? 17 ?) — à confirmer via la relance ; MVP cible 18.0.
- **Quota free tier** (200/mois) : suffisant pour saisie manuelle ; usage massif → credits/x402.
- **Bug annexe noté** (hors scope) : l'`outputExample` x402 de `validate` diverge de la réponse
  réelle (camelCase vs snake_case) — à corriger côté API dans une tâche séparée.
