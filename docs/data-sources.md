# Sources de données — inventaire

**Relevé le 22/08/2026, en comptant les lignes réellement servies.** La version
précédente de ce fichier datait du 01/04/2026, ne couvrait que la recherche de
sources BIC, et en documentait trois sur les treize utilisées aujourd'hui.

> ⚠️ **Ce document n'est pas un avis juridique.** La colonne « licence » dit ce
> qui a été établi et, quand rien ne l'a été, l'écrit. Une licence supposée est
> pire qu'une licence inconnue : elle empêche d'aller vérifier.

## Ce qui alimente `bic.sqlite`

Comptes relevés le 22/08/2026, à recompter après chaque rafraîchissement
mensuel (`getEntryCount()`, jamais un nombre écrit à la main).

| Source | Lignes | Licence | Établie ? |
|---|---:|---|---|
| PeterNotenboom/SwiftCodes | 82 085 | MIT | ✅ licence dans le dépôt |
| GLEIF (BIC↔LEI) | 39 265 | **CC0** | ✅ **vérifié à la source le 23/08/2026** |
| Deutsche Bundesbank (Bankleitzahlendatei) | 143 | usage professionnel autorisé, **attribution obligatoire**, sans modification | ✅ **vérifié le 23/08/2026** — deux réserves ci-dessous |
| SIX BankMaster (clearing suisse) | 1 165 | « may be used freely » | ✅ **vérifié le 23/08/2026** |
| SIX Group (BIC) | 19 | même publication que le BankMaster | ⚠️ à confirmer séparément |
| EBA Clearing STEP2 SCT | 183 | fichier de participants publié | ❌ non établie — page 403 le 23/08 |
| NBP (Pologne) | 21 | publication publique | ❌ non établie |

### Ce qui a été lu, mot pour mot

Relevé le **23/08/2026**. Chaque ligne porte la phrase citée et l'URL, pour que le
prochain lecteur puisse contredire plutôt que refaire.

**GLEIF — CC0.** ✅
> « The data on GLEIF's website is provided under a Creative Commons (CC0) license. »
> — <https://www.gleif.org/en/about/open-data>

Aucune obligation d'attribution n'est énoncée. CC0 est une renonciation au droit
d'auteur, pas une licence à conditions.

**SIX BankMaster — usage libre.** ✅
> « All the details published in the Bank Master Data are based on information
> provided by the respective banks/institutions. **Information in the Download
> Bank Master may be used freely.** SIX assumes no responsibility for the
> completeness of this information, nor for any damages from actions taken based
> on this information. SIX reserves the express right to change or delete this
> information from its website at any time. »
> — *Record description bank master V3.0*, daté 03/2023, marqué « Sensitivity:
> C1 Public », page 3 :
> <https://www.six-group.com/dam/download/banking-services/interbank-clearing/en/bc_bank_master/bankmaster-v3-record-description-en.pdf>

🚨 **Piège majeur, à ne pas rejouer.** Les *conditions générales du site* SIX
disent l'**inverse** :
> « The entire content of the SIX website is protected by copyright law.
> Consequently, presentations, brochures, flyers, graphics, texts, designs,
> charts, etc., may not be reproduced or reused in any way or used for commercial
> purposes. » — <https://www.six-group.com/en/services/legal/terms-of-use.html>

Cette clause énumère du **contenu éditorial** (brochures, textes, graphiques),
et la page de téléchargement du Bank Master ne publie, elle, aucune condition.
**La condition qui gouverne la donnée est celle du document qui accompagne la
donnée**, pas celle du site qui l'héberge. Un balayage qui s'arrête aux CGU
conclut à l'interdiction et fait retirer une source parfaitement utilisable.

**Deutsche Bundesbank — autorisé, sous deux conditions.** ✅
> « It is free for you to store, forward or reproduce information created by the
> Deutsche Bundesbank for your personal or **business** use. The information must
> not be changed or falsified. » — attribution demandée : **« Quelle: Deutsche
> Bundesbank »**
> — <https://www.bundesbank.de/de/startseite/benutzerhinweise/nutzungsbedingungen-fuer-den-allgemeinen-gebrauch-der-website-763554>

⚠️ **Deux réserves, à trancher par Claude-Alain, pas par moi :**
1. **L'attribution demandée est une formule exacte** — « Quelle: Deutsche
   Bundesbank ». Nos surfaces écrivent « Bundesbank ». Proche, pas identique.
2. **« must not be changed or falsified »** : nous ne falsifions rien, mais nous
   reformatons (import en base, service via API, BIC recomposé). Savoir si cela
   compte comme une modification est une question à poser à la Bundesbank, pas à
   résoudre en lisant la phrase une deuxième fois.

⚠️ **La restriction commerciale de la Bundesbank ne s'applique PAS aux données.**
La phrase « Eine darüber hinausgehende Nutzung für kommerzielle Zwecke … ist
nicht zulässig » figure dans la section **images et vidéos**. La confondre avec
la règle sur les données ferait retirer une source utilisable — symétrique du
piège SIX ci-dessus.

## Ce qui alimente `compliance.sqlite`

| Source | Contenu | URL de rafraîchissement |
|---|---|---|
| OFAC (US Treasury) | 223 entités | `treasury.gov/ofac/downloads/sdn.csv` |
| ONU | 5 entités | `scsanctions.un.org/resources/xml/en/consolidated.xml` |
| Union européenne | 2 entités | `webgate.ec.europa.eu/fsd/fsf/…` |
| SECO (Suisse) | fetch en place | `sesam.search.admin.ch/…` |
| GAFI / FATF | listes pays | relevé `fatf_as_of` en base |
| EPC — SCT | participants | `europeanpaymentscouncil.eu/…/sct.csv` |
| EPC — SCT Inst | participants | `…/sct_inst.csv` |
| EPC — SDD Core | participants | `…/sdd_core.csv` |
| EPC — VoP | participants | `…/vop.csv` |

⚠️ **Le fetch SECO rendait zéro ligne au 26/07/2026** (constat du correctif
`f8547b4`). Vérifié le 22/08 : les sanctions en base portent OFAC, UN et EU.
**SECO n'y apparaît pas.** Le flux est branché, il ne rapporte rien : ne pas
annoncer SECO tant que la table ne le porte pas.

## Hors dépôt, délibérément

**Vocalink — table de contrôle modulo britannique** (`valacdos.txt`,
`scsubtab.txt`), téléchargée à la construction de l'image par
`scripts/seed-uk-modulus.ts`.

🚨 **Ne doit jamais entrer dans le dépôt ni dans un paquet publié.** Vérifié le
22/08 : absente du dépôt, absente de l'historique, absente du paquet npm du SDK
(4 fichiers packés : README, deux fichiers `dist`, manifeste). Le Dockerfile
tolère l'échec de ce téléchargement : un lien pourri doit coûter le contrôle
britannique, jamais le déploiement.

## Ce que les surfaces publiques annoncent

- Pied de page, **corrigé le 22/08/2026** : il citait quatre sources sur treize et
  leur attribuait à toutes un rafraîchissement mensuel. Il nomme désormais les six
  registres bancaires **et** les listes de sanctions, chaque groupe avec **sa vraie
  cadence** — mensuelle pour les données bancaires (`refresh-bic.yml`, `0 3 1 * *`),
  hebdomadaire pour les sanctions et les registres EPC (`refresh-compliance.yml`,
  `0 3 * * 0`). Les deux cadences sont vérifiées sur les exécutions réelles.
- ⚠️ **Deux sources sont volontairement absentes du pied de page** :
  **SECO**, parce que son flux ne rapporte rien (voir plus haut), et **le GAFI**,
  parce que ses listes sont **statiques** — maintenues à la main dans
  `src/lib/compliance-static.ts` et datées par `FATF_AS_OF`. Le workflow les
  réinsère chaque semaine, ce qui n'est pas la même chose que les rafraîchir.
  Les ranger sous « hebdomadaire » aurait été faux.
- Accueil et `/llms.txt` : GLEIF, annuaire SWIFT, Bundesbank, SIX, NBP, EBA Step2.
- **Aucune licence n'est nommée sur aucune surface publique.**

## Ce qui reste à faire, par ordre de risque

1. **Établir les licences encore marquées ❌.** Quatre sur treize sont établies
   depuis le 23/08 (SwiftCodes, GLEIF, Bundesbank, SIX BankMaster). Restent
   **EBA Clearing** (la page des participants rend 403 à une lecture
   automatisée — passer par un navigateur), **NBP**, **OFAC**, **ONU**, **UE**,
   **EPC** et le **GAFI**. Les cinq derniers sont des publications
   d'autorités : leur statut est probablement permissif, ce qui n'est pas la
   même chose qu'établi.
2. ✅ **Pied de page aligné le 22/08/2026** — voir la section ci-dessus.
3. **Décider si les licences doivent être publiées.** Pour un acheteur qui
   passe par un service achats, une page qui nomme ses sources et leurs
   conditions est un argument ; son absence est une question de plus à traiter
   par mail.

## Sources écartées, et pourquoi

| Source | Motif |
|---|---|
| OpenSanctions ISO 9362 | licence non commerciale |
| baumerdev/bankdata-germany | AGPL |
| maranemil/swift-bic-all | licence inconnue, données obtenues par moissonnage |

**How to apply :** ce fichier se recompte, il ne se recopie pas.
`sqlite3 data/bic.sqlite "SELECT source, COUNT(*) FROM bic_entries GROUP BY source"`
et `sqlite3 data/compliance.sqlite "SELECT source_list, COUNT(*) FROM sanctioned_entities GROUP BY source_list"`
donnent les deux tableaux du haut.
