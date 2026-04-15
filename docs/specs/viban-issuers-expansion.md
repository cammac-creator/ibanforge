# vIBAN Issuers Expansion — Research Spec

> Objectif : passer de ~30 a 80+ entrees dans `src/lib/issuers.ts`
> Date : 2026-04-10
> Statut : recherche terminee, en attente d'implementation

---

## 1. Corrections requises (BIC8 errones dans le fichier actuel)

Les recherches web revelent que plusieurs BIC8 actuellement dans `issuers.ts`
sont soit incorrects, soit non confirmables. **Ces corrections doivent etre
appliquees en priorite.**

| BIC8 actuel | Institution assignee | Probleme | BIC8 correct | Pays |
|-------------|---------------------|----------|-------------|------|
| `BARCNL22` | Banking Circle | BARCNL22 = Barclays Netherlands, pas Banking Circle | `BCIRLULL` | LU |
| `EABORL2X` | Paysera | Non confirme ; Paysera = EVIULT2V | `EVIULT2V` | LT |
| `CBNOLT2X` | ConnectPay | Non confirme ; ConnectPay = CNUALT21 | `CNUALT21` | LT |
| `MANOLT22` | Mangopay | Non confirme ; Mangopay = MAGYLUL1 | `MAGYLUL1` | LU |
| `CPAYIE2D` | Checkout.com | CPAYIE2D = Fire Financial Services, pas Checkout.com | `CPAYIE2D` | IE (garder, mais renommer en Fire Financial Services) |
| `SWOIFRPP` | Swan | Non confirme ; Swan = SWNBFR22 | `SWNBFR22` | FR |
| `SUMSLT21` | SumUp | Non confirme ; SumUp LT = SUPULT22 | `SUPULT22` | LT |
| `MOLOIE22` | Modulr (IE) | Non confirme ; Modulr IE = MODRIE22 | `MODRIE22` | IE |
| `FABORL2X` | Finom | Non confirme ; Finom = FNOMNL22 | `FNOMNL22` | NL |

## 2. Entrees non verifiees (a confirmer manuellement)

Ces entrees existent dans `issuers.ts` mais n'ont pas ete confirmees par
les sources publiques. A verifier avant de les conserver.

| BIC8 actuel | Institution | Probleme |
|-------------|------------|----------|
| `RABORL2X` | Revolut (LT alt) | Aucun resultat. Les BIC Revolut confirmes sont REVOLT21, REVOGB2L, RVUALT2V |
| `RABORL22` | Railsr | Aucun BIC trouve pour Railsr dans les registres publics |
| `SUGBIE22` | Stripe (IE) | Non confirme. Stripe IE = STPUIE21 et STTOIE22 |
| `STPKIE21` | Stripe (IE alt) | Non confirme. Voir STPUIE21 |
| `PPAYIE2D` | Prepay Solutions (IE) | Non confirme. Prepay Technologies UK = PRTCGB21 |
| `TOBADED1` | Tomorrow Bank (DE) | Non confirme. Tomorrow utilise Solarisbank (SOBKDEBB) |

## 3. Note sur les types

Le type `IssuerType` actuel est : `'bank' | 'digital_bank' | 'emi' | 'payment_institution'`

La demande mentionne le type `'neobank'`, qui **n'existe pas** dans le code actuel.
Convention recommandee :
- Les neobanques avec licence bancaire complete -> `'digital_bank'`
- Les neobanques operant sous licence EMI -> `'emi'`
- Les fournisseurs BaaS avec licence bancaire -> `'payment_institution'`

Si un type `'neobank'` doit etre ajoute, il faudra aussi mettre a jour
`src/lib/issuers.ts` (type union) et potentiellement l'enrichissement.

---

## 4. Nouvelles entrees a ajouter

### Legende des niveaux de confiance

- **A** = BIC confirme par 3+ sources independantes (Wise, bank.codes, theswiftcodes, etc.)
- **B** = BIC confirme par 1-2 sources
- **C** = BIC trouve mais avec incertitudes (code inactif, multiples variantes)

---

### 4.1 Digital banks (licence bancaire, digital-only)

| BIC8 | Institution | Type | Pays | vIBAN | Confiance | Notes |
|------|------------|------|------|-------|-----------|-------|
| `REVOGB2L` | Revolut | digital_bank | GB | oui | A | Code actif UK (remplace REVOGB21 inactif) |
| `RVUALT2V` | Revolut Bank UAB | digital_bank | LT | oui | A | Licence bancaire LT, BIC actif |
| `MEMOFRP2` | Memo Bank | digital_bank | FR | non | A | Banque FR pour PME |
| `TIPLGB22` | Tide | digital_bank | GB | non | A | Business neobank UK |
| `PLEODKK2` | Pleo | digital_bank | DK | non | A | Expense management DK |

### 4.2 EMIs (Electronic Money Institutions)

| BIC8 | Institution | Type | Pays | vIBAN | Confiance | Notes |
|------|------------|------|------|-------|-----------|-------|
| `BCIRLULL` | Banking Circle | emi | LU | oui | A | Infrastructure financiere, remplace BARCNL22 |
| `SAPYGB2L` | Banking Circle (GB) | emi | GB | oui | B | Branche GB |
| `SXPYDEHH` | Banking Circle (DE) | emi | DE | oui | B | Branche DE |
| `PAYNIE22` | Payoneer Europe | emi | IE | oui | A | vIBAN multi-devises |
| `AIRWGB22` | Airwallex (UK) | emi | GB | oui | A | Paiements cross-border |
| `AINHNL22` | Airwallex (NL) | emi | NL | oui | B | Branche NL |
| `TCCLGB3L` | Currencycloud (Visa) | emi | GB | oui | A | Fournisseur vIBAN |
| `CURUNL21` | Currencycloud (NL) | emi | NL | oui | B | Entite NL |
| `EBURGB2L` | Ebury Partners (UK) | emi | GB | oui | A | FX et paiements PME |
| `EBPBBEBB` | Ebury Partners (BE) | emi | BE | oui | A | Entite EU |
| `PATCBGSF` | Paynetics | emi | BG | oui | A | EMI bulgare, BaaS |
| `CARDCY2L` | Unlimint | emi | CY | oui | A | EMI chypriote |
| `CARDDEFF` | Unlimint (DE) | emi | DE | oui | B | Branche DE |
| `MLLENL2A` | Mollie | emi | NL | oui | B | PSP neerlandais |
| `LEWAFRPP` | Lemonway | emi | FR | oui | A | Payment institution FR |
| `WFSTGB2L` | WorldFirst | emi | GB | oui | A | FX et paiements (Ant Group) |
| `EVIULT2V` | Paysera | emi | LT | oui | A | Remplace EABORL2X |
| `CNUALT21` | ConnectPay | emi | LT | oui | A | Remplace CBNOLT2X |
| `MAGYLUL1` | Mangopay | emi | LU | oui | A | Remplace MANOLT22 |
| `SWNBFR22` | Swan | emi | FR | oui | A | BaaS FR, remplace SWOIFRPP |
| `SUPULT22` | SumUp EU Payments | emi | LT | oui | A | Remplace SUMSLT21 |
| `SUMUIE22` | SumUp (IE) | emi | IE | non | B | Entite irlandaise |
| `MNEEGB21` | Monese (UK) | emi | GB | oui | A | Digital banking EMI |
| `MNEEBEB2` | Monese EU SA | emi | BE | oui | A | Entite EU, vIBAN EUR |
| `VPAYGRAA` | Viva Wallet | emi | GR | oui | A | EMI grecque (J.P. Morgan) |
| `LYDIFRP2` | Lydia Solutions | emi | FR | oui | A | Super app paiement FR |
| `BIPGATWW` | Bitpanda | emi | AT | non | A | Crypto + investissement |
| `JOEULUL2` | Vivid Money | emi | LU | oui | A | Neobank via EMI LU |
| `VVIDLUL2` | Vivid Money (alt) | emi | LU | oui | B | BIC alternatif |
| `UAPELT22` | Pervesk | emi | LT | oui | A | EMI lituanienne |
| `BIYSGB2L` | Bilderlings Pay | emi | GB | oui | A | EMI UK, multi-devises |
| `BAXXLT22` | Finci | emi | LT | oui | A | EMI lituanienne |
| `PYSEGB22` | Payset | emi | GB | oui | A | EMI UK, vIBAN |
| `VEPALT21` | Verifo (Verified Payments) | emi | LT | oui | A | BaaS lituanien |
| `DYPYGB3L` | MultiPass | emi | GB | oui | B | EMI UK multi-devises |
| `NARYFIH2` | Narvi Payments | emi | FI | oui | A | EMI finlandaise |
| `BZENLT22` | Zen.com | emi | LT | oui | A | EMI lituanienne |
| `MIEGLT21` | Satchel (Secure Nordic Payments) | emi | LT | oui | A | Confirme pour Mister Tango |
| `USPELT2V` | Nuvei | emi | LT | oui | A | EMI, crypto-fiat |
| `MNNELT21` | Genome (Maneuver Lt) | emi | LT | oui | B | EMI lituanienne |
| `UAPPLT21` | Ibanera (Phoenix Payments) | emi | LT | oui | B | vIBAN provider |
| `FNOMNL22` | Finom Payments | emi | NL | oui | A | Remplace FABORL2X |
| `FNOMFRP2` | Finom Payments (FR) | emi | FR | oui | B | Branche FR |
| `FNOMDEB2` | Finom Payments (DE) | emi | DE | oui | B | Branche DE |
| `SAEYGB2L` | SafeNetPay | emi | GB | oui | B | EMI UK |
| `ADWSGB22` | Monevium | emi | GB | oui | B | EMI UK |
| `CFTEMTM1` | OpenPayd (Malta) | emi | MT | oui | A | BaaS, vIBAN multi-devises |
| `SOAVGB21` | Soldo (UK) | emi | GB | non | B | Gestion des depenses |
| `SFSNIE22` | Soldo (IE) | emi | IE | non | B | Entite irlandaise |
| `CNFVGB21` | Contis Financial (UK) | emi | GB | oui | A | EMI UK, prepaid/BaaS |
| `UFPOLT21` | Contis Financial (LT) | emi | LT | oui | B | Entite lituanienne |
| `TPMLMTMT` | TransactPay (Malta) | emi | MT | oui | A | Card issuer EMI |
| `TRYAGIG2` | TransactPay (Gibraltar) | emi | GI | oui | A | Card issuer EMI |
| `PPSEIE22` | Paysafe Prepaid (IE) | emi | IE | oui | A | EMI irlandaise |
| `NETEGB21` | Paysafe Financial (UK) | emi | GB | oui | B | EMI UK |

### 4.3 Payment institutions / BaaS

| BIC8 | Institution | Type | Pays | vIBAN | Confiance | Notes |
|------|------------|------|------|-------|-----------|-------|
| `MODRGB21` | Modulr FS (UK) | payment_institution | GB | oui | A | BaaS UK, BIC actif |
| `MODRIE22` | Modulr Finance (IE) | payment_institution | IE | oui | A | Remplace MOLOIE22 (revoquee 12/2022) |
| `TRYEGB22` | TrueLayer | payment_institution | GB | non | A | Open banking / PISP |
| `GOCRGB22` | GoCardless | payment_institution | GB | non | A | Direct debit payments |
| `OFPIIE22` | OFX Payments Ireland | payment_institution | IE | non | A | FX et paiements |
| `STPUIE21` | Stripe Payments Europe | payment_institution | IE | non | A | Remplace SUGBIE22 |
| `STTOIE22` | Stripe Technology Europe | payment_institution | IE | non | A | Entite tech IE |
| `YOUIFRPP` | Younited | payment_institution | FR | non | A | Credit digital FR |
| `PRTCGB21` | Prepay Technologies | payment_institution | GB | oui | A | BaaS UK (Tide backend) |
| `EUEBLT22` | European Merchant Bank | payment_institution | LT | oui | A | Banque LT pour fintechs |

### 4.4 BIC confirmes a conserver (entrees existantes validees)

Ces entrees sont deja dans `issuers.ts` et sont confirmees correctes :

| BIC8 | Institution | Type | Statut |
|------|------------|------|--------|
| `REVOLT21` | Revolut (LT) | digital_bank | Confirme (inactif dans certaines sources, mais reconnu) |
| `NTSBDEB1` | N26 | digital_bank | Confirme |
| `MONZGB2L` | Monzo | digital_bank | Confirme |
| `SRLGGB2L` | Starling Bank | digital_bank | Confirme |
| `BUNQNL2A` | bunq | digital_bank | Confirme |
| `QNTOFRP1` | Qonto (Olinda) | digital_bank | Confirme (code peut-etre inactif, QNTOFRPA alternatif) |
| `LUALDK22` | Lunar | digital_bank | Non recherche mais plausible |
| `TRWIBEB1` | Wise (BE) | emi | Confirme (signale inactif, TRWIBEBB alternatif) |
| `TRWIGB2L` | Wise (GB) | emi | Non recherche mais plausible |
| `ADYBNL2A` | Adyen | emi | Confirme |
| `TRZOFR21` | Treezor | emi | Confirme (signale inactif dans certaines sources) |
| `CLRBGB22` | ClearBank | emi | Confirme |
| `SOBKDEB2` | Solarisbank | payment_institution | Confirme (SOBKDEBB aussi valide) |
| `LHVBEE22` | LHV Bank | payment_institution | Confirme |

---

## 5. Resume chiffre

| Categorie | Nombre |
|-----------|--------|
| Entrees actuelles confirmees | 14 |
| Corrections de BIC errones | 9 |
| Entrees non verifiees a investiguer | 6 |
| Nouvelles entrees digital_bank | 5 |
| Nouvelles entrees emi | 49 |
| Nouvelles entrees payment_institution | 10 |
| **Total apres implementation** | **~84** |

---

## 6. Sources de recherche

- [Wise SWIFT Code Finder](https://wise.com/us/swift-codes/)
- [bank.codes SWIFT Lookup](https://bank.codes/)
- [theswiftcodes.com](https://www.theswiftcodes.com/)
- [bank-code.net](https://bank-code.net/)
- [thebanks.eu EMI Database](https://thebanks.eu/emis)
- [Qonto SWIFT Code Directory](https://qonto.com/en/swift-codes/)
- [IBANAPI](https://ibanapi.com/)
- [Bank Pulse](https://bankpulse.io/)
- [Remitly SWIFT Finder](https://www.remitly.com/us/en/swift-codes)

---

## 7. Prochaines etapes

1. Appliquer les corrections de la section 1
2. Supprimer ou corriger les entrees non verifiees (section 2)
3. Ajouter les nouvelles entrees (section 4)
4. Optionnellement ajouter le type `'neobank'` si desire
5. Ecrire des tests pour les nouvelles entrees
6. Mettre a jour le commentaire en-tete avec le nouveau nombre d'entrees
