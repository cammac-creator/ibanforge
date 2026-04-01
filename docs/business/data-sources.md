# Sources de donnees BIC/SWIFT — Recherche 2026-04-01

## Source actuelle
- **GLEIF BIC-LEI mapping** : 39 243 entrees, CC0, CSV mensuel
- **bic_data.json** : 6 908 correspondances bankcode→BIC (10 pays EU), probablement via sigalor/iban-to-bic

## Sources exploitables (licence OK)

### 1. Deutsche Bundesbank — Bankleitzahlendatei
- URL: https://www.bundesbank.de/de/aufgaben/unbarer-zahlungsverkehr/serviceangebot/bankleitzahlen/download-bankleitzahlen-602592
- ~16 000-20 000 banques DE avec BIC, nom, adresse
- Format: CSV/TXT/XML, mise a jour trimestrielle
- Licence: gratuit, usage libre

### 2. SIX Group — Swiss Bank Master
- URL: https://www.six-group.com/en/products-services/banking-services/interbank-clearing/online-services/download-bank-master.html
- ~350 banques CH avec BC number, BIC, adresse
- Format: CSV/JSON (API REST), mise a jour quotidienne
- Licence: usage libre

### 3. sigalor/iban-to-bic (MIT)
- URL: https://github.com/sigalor/iban-to-bic
- ~6 900 correspondances bankcode→BIC pour AT, BE, DE, ES, FR, GB, IT, LU, NL
- Format: JSON, mise a jour manuelle
- Source probable de notre bic_data.json actuel

### A investiguer
- Banco de Espana — registre officiel
- Banca d'Italia — fichiers ABI/CAB avec BIC (~50 700 agences)

## Sources NON exploitables
- OpenSanctions ISO 9362 (32K entrees) — licence NonCommercial
- baumerdev/bankdata-germany — licence AGPL
- maranemil/swift-bic-all — licence inconnue, scraping

## Potentiel d'enrichissement
39K actuelles → ~55K+ avec Bundesbank + SIX Group + mise a jour sigalor
