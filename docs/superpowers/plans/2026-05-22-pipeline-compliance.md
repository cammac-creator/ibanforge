# Sous-projet A — Pipeline compliance — Plan d'implémentation

> Exécution inline, TDD, commits fréquents. Spec : `docs/superpowers/specs/2026-05-22-pipeline-compliance-design.md`.

**Goal :** Fiabiliser le pipeline compliance — listes FATF/pays sanctionnés dans un module daté, extraction des BIC sanctionnés validée, ajout de la liste SECO.

**Architecture :** un module statique TypeScript `compliance-static.ts` porte les listes (datées via `FATF_AS_OF`) ; `scripts/refresh-compliance.ts` l'importe, durcit l'extraction BIC (`validateBIC` + recoupement de `bic_entries`), et ajoute SECO comme 4ᵉ source OpenSanctions.

**Tech :** TypeScript strict, better-sqlite3, vitest.

**État vérifié :** `bic.sqlite` a une table `bic_entries(bic8 TEXT, …)` — 121 399 lignes. `bic-validator.ts` exporte `validateBIC(input): BICValidationResult`. `compliance.test.ts` ne teste que `calculateRiskScore` avec des inputs construits à la main → **recaler les listes ne casse aucun test existant**.

---

### Task 1 — Module `compliance-static.ts` daté + branchement

**Files :** Create `src/lib/compliance-static.ts` · Modify `scripts/refresh-compliance.ts` · Create `src/lib/compliance-static.test.ts`

- [ ] **1a — Rechercher la liste FATF à jour.** Recherche web : la « grey list » FATF (jurisdictions under increased monitoring) et la « black list » de la **dernière plénière** (février 2026). Noter les codes ISO-2 exacts.
- [ ] **1b — Créer `src/lib/compliance-static.ts`.** Module TS typé (pattern `issuers.ts`). En-tête : commentaire indiquant la dernière plénière FATF + **la prochaine** (juin 2026). Exporte :
  - `export const FATF_AS_OF = '2026-02';`
  - `FATF_BLACK_LIST`, `FATF_GREY_LIST`, `FATF_MEMBERS` (string[] de codes ISO-2) — recalés selon 1a ;
  - `SANCTIONED_COUNTRIES_COMPREHENSIVE`, `SANCTIONED_COUNTRIES_SECTORAL` (reprendre les valeurs actuelles du script, vérifier les régimes 2026).
- [ ] **1c — Test failing** `compliance-static.test.ts` : `FATF_AS_OF` matche `/^\d{4}-\d{2}$/` ; les 5 listes sont non vides ; pas de doublon entre black et grey. Lancer → échoue (module pas importé).
- [ ] **1d — Modifier `refresh-compliance.ts` :** importer les 6 constantes + `FATF_AS_OF` depuis `../src/lib/compliance-static.js` ; supprimer les constantes inline. Dans `insertMetadata`, ajouter `insertMeta.run('fatf_as_of', FATF_AS_OF)`. Au début de `main()`, un garde-fou : si `FATF_AS_OF` (parsé) remonte à plus de 5 mois, `console.warn('[compliance] FATF lists are stale (as of ' + FATF_AS_OF + ') — recalibrate after the latest FATF plenary.')`.
- [ ] **1e — Lancer le test** → vert. `npx vitest run src/lib/compliance-static.test.ts`.
- [ ] **1f — Commit** : `feat(compliance): extract FATF + sanctioned-country lists into a dated module`.

### Task 2 — Extraction des BIC sanctionnés validée

**Files :** Modify `scripts/refresh-compliance.ts`

- [ ] **2a — Test failing.** Dans `compliance-static.test.ts` ou un nouveau fichier, tester une fonction pure `keepBic(bic8, isKnown)` : rejette un format invalide, rejette un format valide mais inconnu (`isKnown=false`), accepte un format valide + connu. (La fonction encapsule `validateBIC(bic8).valid && isKnown`.)
- [ ] **2b — Implémenter.** Dans `refresh-compliance.ts` : importer `validateBIC` depuis `../src/lib/bic-validator.js`. Avant `fetchOpenSanctions`, ouvrir `bic.sqlite` en lecture seule (`new Database(resolve(DATA_DIR,'bic.sqlite'), { readonly: true })`) et préparer `SELECT 1 FROM bic_entries WHERE bic8 = ? LIMIT 1`. Dans `importSanctionsCSV`, pour chaque BIC candidat extrait : ne l'insérer que si `validateBIC(bic8).valid` **et** la requête de recoupement renvoie une ligne. Compter et journaliser les candidats rejetés (`console.log` par source : `X BICs extracted, Y kept after validation`). Fermer la connexion bic.sqlite en fin de run.
- [ ] **2c — Lancer le test** → vert.
- [ ] **2d — Commit** : `feat(compliance): validate sanctioned BICs against format + the BIC base`.

### Task 3 — Ajout de la liste SECO

**Files :** Modify `scripts/refresh-compliance.ts`

- [ ] **3a — Vérifier le slug SECO.** `curl -s https://data.opensanctions.org/datasets/index.json` (ou la page datasets) pour confirmer le dataset suisse SECO et l'URL exacte de son `targets.simple.csv` (`ch_seco_sanctions` probable).
- [ ] **3b — Implémenter.** Ajouter `{ name: 'SECO', url: '<url confirmée>' }` au tableau `SANCTIONS_SOURCES` de `fetchOpenSanctions`. Mettre à jour la metadata `sources` (`'OpenSanctions,FATF,EPC-SCT,EPC-SDD,EPC-SCT_INST'` → ajouter le marqueur SECO).
- [ ] **3c — Commit** : `feat(compliance): add the Swiss SECO sanctions list as a 4th source`.

### Task 4 — Vérification et livraison

- [ ] **4a — `npm run check`** : typecheck + lint + tests, tout vert.
- [ ] **4b — Régénérer la base.** `npm run compliance:refresh`. Vérifier le résumé : présence de la source SECO, compteurs « kept after validation » cohérents, `fatf_as_of` en metadata, pas de `console.warn` de fraîcheur.
- [ ] **4c — Commit + push.** `git add` ciblé : `src/lib/compliance-static.ts`, `src/lib/compliance-static.test.ts`, `scripts/refresh-compliance.ts`, `data/compliance.sqlite` (régénéré). Commit `chore(compliance): refresh compliance.sqlite with hardened pipeline`, puis `git push`.
- [ ] **4d — Vérifier en production** (après redéploiement Railway) : `curl` sur `POST /v1/iban/compliance` avec un IBAN connu → la réponse contient un `risk_score` cohérent.

---

## Notes

- `compliance.sqlite` est un fichier suivi dans git et rafraîchi par le cron `refresh-compliance.yml` — le régénérer et le committer en 4c livre les améliorations immédiatement (sans attendre le cron du dimanche).
- Si `compliance:refresh` échoue au téléchargement (réseau, URL SECO), corriger l'URL et relancer — ne pas committer une base partielle.
- Hors périmètre : REGAFI, migration hors OpenSanctions, sous-projets B et C.
