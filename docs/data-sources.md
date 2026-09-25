# Sources de données — inventaire

**Relevé le 22/08/2026, en comptant les lignes réellement servies.** La version
précédente de ce fichier datait du 01/04/2026, ne couvrait que la recherche de
sources BIC, et en documentait trois sur les treize utilisées aujourd'hui.

> ⚠️ **Ce document n'est pas un avis juridique.** La colonne « licence » dit ce
> qui a été établi et, quand rien ne l'a été, l'écrit. Une licence supposée est
> pire qu'une licence inconnue : elle empêche d'aller vérifier.

## 25/09/2026 : la famille sous conditions a quitté le dépôt public

Ce qui peut être servi mais pas redistribué (décision de Claude-Alain du
24/09/2026, liste unique dans `src/lib/restricted-family.ts`) n'est plus dans
aucun fichier de ce dépôt, hors historique git :

| Retiré | D'où | Servi par l'API ? |
|---|---|---|
| lignes `eba_step2`, `nbp`, `oenb` de `bic_entries` ; registres AT, BE, SM de `national_bank_codes` ; `pra_banks` | `data/bic.sqlite` | oui, depuis le dépôt privé (surcouche) |
| liste `UN` de `sanctioned_entities` ; `sepa_participants` ; `vop_participants` | `data/compliance.sqlite` | oui, depuis le dépôt privé (surcouche) |
| clés AT, BE, LU, PL, FI (5 454 clés) | `src/db/bic_data.json` | AT, BE : par les registres de la surcouche ; **PL, FI, LU : par la surcouche** (membres `map_pl`, `map_fi`, `map_lu`, table `curated_bank_codes`, reconstruits chaque mois depuis la publication PyPI de schwifty) ; LU aussi par le registre de l'ABBL (fichier privé) |
| liste transcrite de Finance Finland | `src/lib/fi-register.ts` (lit désormais la base servie) | oui, par la surcouche (membre `register_fi`, liste statique recopiée d'une surcouche à l'autre) |
| exports AT, BE, SM ; blocs EPC des autres exports et des exemples | `frontend/data/`, fixtures MCP et SDK, documentation | les pages `/at`, `/be`, `/sm` lisent l'API à la demande |
| entrées GB (FCA) | `scripts/data/eu-emi-register-2026-05-22.json` | non |

Les robots publics tournent avec `SEED_FAMILY=public` (valeur par défaut) : ils
ne téléchargent plus aucun membre et écrivent des bases sans la famille ;
`src/lib/public-base-family-free.test.ts` échoue si une ligne revient. Les bases
suivies se reconstruisent sans téléchargement par `npm run overlay -- strip`.
Sans surcouche, chaque réponse qui dépend de la famille dit « non consulté »
(`national_register_unavailable`, `screened: false`, drapeaux `*_unavailable`),
jamais « non ». Dans les tableaux ci-dessous, les lignes de ces sources
décrivent désormais ce que sert l'API, pas le contenu du dépôt ; leurs comptes
datent d'avant le retrait.

## Ce qui alimente `bic.sqlite`

Comptes relevés le 22/08/2026, à recompter après chaque rafraîchissement
mensuel (`getEntryCount()`, jamais un nombre écrit à la main).

| Source | Lignes | Licence | Établie ? |
|---|---:|---|---|
| PeterNotenboom/SwiftCodes | 82 102 | MIT accordée par l'auteur du dépôt, **pas par SWIFT** | ⚠️ **droits de SWIFT non établis** (groupe B de `NOTICE` depuis le 24/09/2026 ; le dépôt dit seulement « All the info is grabbed from public websites ») — ⚠️ **données figées à janvier 2018**, voir ci-dessous |
| GLEIF (LEI) et table BIC↔LEI de SWIFT | 39 297 | **CC0** pour les données LEI ; la **table BIC↔LEI** relève de la licence de SWIFT, avec sa mention obligatoire (voir plus bas) | ✅ CC0 **vérifié à la source le 23/08/2026** ; licence SWIFT **lue le 24/09/2026** |
| Deutsche Bundesbank (Bankleitzahlendatei) | 143 | usage professionnel autorisé, **attribution obligatoire**, sans modification | ✅ **vérifié le 23/08/2026** — deux réserves ci-dessous |
| SIX BankMaster (clearing suisse) | 1 164 | « may be used freely » | ✅ **vérifié le 23/08/2026** |
| SIX Group (BIC) | 20 | même publication que le BankMaster | ⚠️ à confirmer séparément |
| EBA Clearing STEP2 SCT | 189 | « All rights reserved by EBA CLEARING », aucune licence publiée | ⏳ **demande de permission envoyée le 16/09/2026** (lettre et précision d'usage à clearing@ebaclearing.eu) ; servi avec crédit en attendant la réponse, retrait sur leur mot — voir la section du 16/09 |
| Oesterreichische Nationalbank — SEPA-Zahlungsverkehrs-Verzeichnis (`national_bank_codes`, pays AT) | 869 au 29/07/2026 | aucune condition sur la page du répertoire (pied « Copyright © Oesterreichische Nationalbank ») ; le jeu est listé sur data.gv.at, où l'usage est en règle générale CC BY 4.0 | ⏳ **lettre envoyée le 16/09/2026** à oenb.info@oenb.at (permission, licence data.gv.at, formule d'attribution) ; servi avec crédit « Source: Oesterreichische Nationalbank, SEPA-Zahlungsverkehrs-Verzeichnis, read in <mois> » |
| Banque nationale de Belgique — bank identification codes, Protocol Secretariat (`national_bank_codes`, pays BE) | 790 au 29/07/2026 | aucune condition sur la page (lue le 16/09/2026 : formulaire pour ajouter/modifier un code, renvoi « to the financial institution concerned or the SWIFT-website » pour un usage précis) | ⏳ **lettre envoyée le 16/09/2026** à info@nbb.be ; servi avec crédit et mois de lecture |
| Finance Finland (Finanssiala ry) — Finnish monetary institution codes and BICs (table `src/lib/fi-register.ts`, pays FI) | 20 lignes, édition du 15.10.2025 | aucune condition sur le site (lu le 16/09/2026) ; document PDF transcrit à la main | ⏳ **lettre envoyée le 16/09/2026** à ffi@financefinland.fi (permission, attribution, notification des éditions). **Régime prudent depuis le 16/09/2026** : un résultat confirme, une absence ne refuse rien (`authoritative: false`) |
| Bulgarian National Bank — registre BAE et BIC (`bg_bae`, pays BG) | par édition du registre | réponse écrite du service de presse le 27/08/2026 : réutilisation permise « respecting the Rights for using the BNB site » = citer la source, ne pas altérer ni déformer | ✅ **accordée sous conditions le 27/08/2026** ; `source` et `as_of` stockés et servis, noms en cyrillique tels que publiés |
| NBP (Pologne) | 21 | publication publique | ❌ non établie — mur anti-robot |
| OFAC (sanctions) | — | domaine public, **17 U.S.C. §105** (le CC0 lu le 24/08/2026 dans l'inventaire du Treasury n'y figure plus le 24/09/2026) | ✅ §105 **vérifié le 24/08/2026** ; CC0 plus vérifiable depuis le 24/09/2026 |
| ONU (liste consolidée CSNU) | — | ⚠️ **tous droits réservés, usage personnel NON COMMERCIAL uniquement** | ✅ établie le 24/08/2026 — position arrêtée, voir la section citations |
| UE (liste consolidée + réutilisation Commission) | — | **CC BY 4.0**, Décision du 12/12/2011 | ✅ vérifié le 24/08/2026 |
| Bank of England — List of PRA-regulated Banks (table `pra_banks`) | 281 au 2026-08 | permission écrite du 25/08/2026, **attribution à la Bank of England ET au mois de la liste obligatoire** | ✅ **accordée le 25/08/2026 — ingérée le 25/08/2026**, voir ci-dessous |
| BCE — liste quotidienne des IFM (table `ecb_mfi`) | 5 373 au 2026-09-16 | usage libre, **citation de la BCE** + **mention « gratuit à la source » à CHAQUE accès** dès que l'information est vendue | ✅ **lue à la source le 26/08/2026 — ingérée le 26/08/2026**, voir ci-dessous |
| Banco de España — liste des IFM espagnoles (table `bde_mfi`) | 238 au 2026-08-25 | reproduction « faithfully, without any manipulation », **citation du Banco de España** + **même mention « gratuit à la source » à chaque mise à disposition** | ✅ **lue à la source le 26/08/2026 — ingérée le 26/08/2026**, voir ci-dessous |
| Národná banka Slovenska — prevodník des codes d'identification (`national_bank_codes`, pays SK) | 38 en version 225 (effet 18.05.2026) | réutilisation et traitement confirmés par écrit le 09/09/2026, **citation de la NBS obligatoire** ; conditions du fichier conservées | ✅ **réponse du 09/09/2026 relue le 14/09/2026** — ingérée le 06/09/2026, voir ci-dessous |
| Česká národní banka — Číselník kódů platebního styku (`national_bank_codes` et `national_bank_codes_pending`, pays CZ) | 46 en édition 254 (effet 01.09.2026) | conditions du site, § 3 : stocker, transmettre et reproduire permis, **« Zdroj: ČNB » obligatoire**, faits et sens d'un extrait inchangés ; avis écrit du service des paiements du 27/08/2026 dans le même sens | ✅ **conditions lues le 24/09/2026 — ingéré le 25/09/2026**, voir ci-dessous |
| Banca d'Italia : registres des banques, établissements de paiement et de monnaie électronique, historique et fusions (`national_bank_codes` et `national_bank_codes_retired`, pays IT) | 464 codes en vigueur et 1 907 radiés, édition du 23/09/2026 | open data **CC BY 4.0** (portail AgID dati.gov.it et catalogue DCAT de la Banca d'Italia) : réutilisation commerciale permise, **citer la source et indiquer les modifications** | ✅ **conditions lues le 24/09/2026 et relues le 25/09/2026, ingéré le 25/09/2026**, registre **partiel**, voir ci-dessous |
| Banca Centrale della Repubblica di San Marino — banques opérationnelles (`national_bank_codes`, pays SM) | 4 au 06/09/2026 | ❓ **AUCUNE condition d'utilisation publiée** — ni licence, ni interdiction | ⚠️ **lue à la source le 06/09/2026 — ingérée le 06/09/2026**, licence `unknown`, lettre à écrire, voir ci-dessous |

### Ce qui a été lu, mot pour mot

Relevé le **23/08/2026**. Chaque ligne porte la phrase citée et l'URL, pour que le
prochain lecteur puisse contredire plutôt que refaire.

**GLEIF — CC0.** ✅
> « The data on GLEIF's website is provided under a Creative Commons (CC0) license. »
> — <https://www.gleif.org/en/about/open-data>

Aucune obligation d'attribution n'est énoncée. CC0 est une renonciation au droit
d'auteur, pas une licence à conditions.

**Table BIC↔LEI de SWIFT — licence lue le 24/09/2026.** ⚠️ La table qui relie
les BIC aux LEI n'est pas couverte par le CC0 de GLEIF : elle est développée par
SWIFT et publiée sous le *BIC/LEI Mapping Table License Agreement* (annexe II,
21/12/2017), lié en pied de la page GLEIF. Licence gratuite pour tout usage, y
compris commercial, « provided always that any copy of the Mapping Table, in
whole or in part, includes the following notice » :
> « SWIFT © and database rights [insert date (i.e. month and year) of the Mapping Table version].
> All rights reserved.
> This Mapping Table has been developed by SWIFT. Any use of the Mapping Table, in whole or
> in part, is subject to the BIC/LEI Mapping Table License Agreement as published with the
> Mapping Table available on GLEIF’s website.
> The Mapping Table is updated monthly. For the latest BIC information and updates, always
> refer to www.swift.com/bic . »
> — <https://www.gleif.org/lei-data/lei-mapping/download-bic-to-lei-relationship-files/2017-12-21_annex-2_bic-to-lei-mapping-table-license-agreement_final.pdf>

La formule servie jusqu'au 24/09/2026 (« This service uses the BIC to LEI
relationship file… ») n'avait aucune source : elle ne figure pas dans cette
licence. `NOTICE` porte la formule exacte, et `/llms.txt` de l'API la sert mot
pour mot depuis la PR 240 (`src/lib/bic-lei-notice.ts`) ; le `llms.txt` du
site renvoie à ce texte servi. Le mois de version n'est stocké nulle part :
`src/db/seed.ts` prend la dernière table publiée (`mapping.gleif.org/api/v2/bic-lei/latest`)
à chaque rafraîchissement mensuel ; les lignes `gleif` du 01/09/2026 viennent
de la version d'août 2026 (`LEI-BIC-20260828.zip`). Le mois servi est donc
déduit de la date de chargement des lignes `gleif` (le mois qui précède le
rafraîchissement du 1er). Reste à faire : stocker ce mois au chargement, ce qui
lèverait la seule limite de cette déduction (un rafraîchissement manuel lancé
entre la publication de fin de mois et la fin de ce mois).

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

**OFAC — domaine public (17 U.S.C. §105) ; CC0 lu le 24/08/2026, plus vérifiable depuis le 24/09/2026.** ✅
> « Copyright protection under this title is not available for any work of the
> United States Government » — 17 U.S.C. §105
> — <https://www.govinfo.gov/content/pkg/USCODE-2023-title17/html/USCODE-2023-title17-chap1-sec105.htm>

Et surtout, la déclaration **propre au dataset** : l'inventaire machine du
Treasury (obligatoire sous l'OPEN Government Data Act) porte pour la liste SDN
`"license": "http://creativecommons.org/publicdomain/zero/1.0/"` —
<https://www.treasury.gov/jsonfiles/data.json>, relayé par
<https://catalog.data.gov/dataset/specially-designated-nationals-sdn-and-blocked-persons-list>.
Seules réserves (usa.gov) : ne pas suggérer d'endossement, ne pas utiliser les
logos fédéraux. Nous ne faisons ni l'un ni l'autre.

⚠️ **Relu le 24/09/2026 : `data.json` ne porte plus aucune entrée OFAC ou SDN**
(231 jeux, aucun ne nomme la liste). La déclaration CC0 lue le 24/08 n'est donc
plus vérifiable ; `NOTICE` ne cite plus que le §105, qui suffit.

**ONU — établie, et c'est la réponse qui dérange.** ⚠️ (24/08/2026)
> « None of the materials provided on this web site may be used, reproduced or
> transmitted, in whole or in part, in any form or by any means […] without
> permission in writing from the publisher. »
> — <https://www.un.org/en/about-us/copyright>
> « The United Nations grants permission to Users to […] download and copy the
> information, documents and materials […] for the User's **personal,
> non-commercial** use »
> — <https://www.un.org/en/about-us/terms-of-use>

Le XML de la liste consolidée lui-même (2,2 Mo, servi via un blob Azure signé)
ne porte **aucune** mention de licence interne. Les conditions générales du
site sont donc la seule base écrite trouvée.
**Un résultat gênant établi vaut plus qu'un résultat commode supposé** — c'est
exactement pour cela qu'on lit à la source.

**Position arrêtée le 24/08/2026 : la source est conservée.** La liste
consolidée du Conseil de sécurité existe pour être appliquée ; elle est
utilisée ici exclusivement à des fins de filtrage de sanctions — l'usage
auquel elle est destinée — comme le fait l'ensemble du secteur de la
conformité. Aucune permission écrite spécifique n'est établie à ce jour, et ce
document le dit plutôt que de le supposer ; une demande de permission reste
possible à tout moment si l'ONU ou un client le souhaite.

**EBA Clearing — pas de licence, nulle part.** ❌ (24/08/2026)
La note du 23/08 (« page 403 ») était un mauvais diagnostic : l'URL avait
changé. La liste vit à
<https://www.ebaclearing.eu/services-sepa-payments/step2-sct/participants/> et
le fichier réel est un XLSX « STEP2 SCT Reachable PSPs List » (~8 700 entrées,
en-têtes BIC / nom / commentaire, aucune clause de droits dans le fichier).
La seule mention trouvée sur tout le site :
> « All rights reserved by EBA CLEARING »
> — <https://www.ebaclearing.eu/legal-and-disclaimer/>

« Tous droits réservés » sans grant publié = pas de permission établie. Même
classe de décision que l'ONU, en moins restrictif (rien n'interdit, rien
n'autorise) : écrire à EBA CLEARING, ou retirer, ou documenter l'incertitude.


### ⚠️ SwiftCodes : la source la plus grosse ne bouge plus depuis 2018

**Relevé le 22/09/2026, à la source.** Le dépôt `PeterNotenboom/SwiftCodes`
n'a plus reçu de publication depuis le **09.08.2019**, et le dernier commit
qui a touché le dossier de données est « Update for 2018 », daté du
**27.01.2018**. Ses 82 102 lignes — environ deux tiers de `bic_entries` —
décrivent donc le paysage bancaire de janvier 2018.

Le rafraîchissement mensuel re-clone ce même fichier figé, donc `updated_at`
avance tous les mois sans que le contenu bouge : la date d'import ne dit rien
de la donnée. C'est pour cela que `src/lib/source-vintage.ts` porte la date
réelle, que `/health` sert `source_as_of` à côté de `last_updated`, et qu'un
BIC résolu par la recherche par préfixe sur une ligne SwiftCodes porte les
deux dates.

**Conséquence pratique** : une banque créée, absorbée ou renommée depuis 2018
peut manquer, ou porter un nom périmé, dans la partie SwiftCodes du
répertoire. Les registres nationaux (SIX, Bundesbank, OeNB, BNB, NBS, ČNB, BNB
bulgare) et GLEIF, eux, sont bien rafraîchis chaque mois — c'est pourquoi
`bank_code_check` et `bic.basis` existent : ils disent quelle partie du
répertoire a répondu.

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

**06/09/2026 — le rafraîchissement hebdomadaire a échoué sur un 500 de l'UE** (SECO a
répondu 500 aussi, comme depuis juillet) : la base produite ne portait plus qu'OFAC et ONU,
la porte des « claims » du workflow l'a refusée (à raison), et la base en production a
vieilli d'une semaine. Relancé à la main le 07/09 (l'UE répondait de nouveau) : succès,
commit `cda7b34b`. Depuis le 07/09, `scripts/compliance-carry-over.ts` recopie la liste
manquante depuis la base précédente quand son téléchargement échoue, à condition que cette
base ait moins de 21 jours, et l'inscrit dans `metadata.carried_over` (liste et date réelle
des lignes) : les listes qui ont rafraîchi partent, la liste en panne est servie périmée et
dite telle, et une panne de trois semaines fait de nouveau échouer le run.

## Carte composite `src/db/bic_data.json` (code banque → BIC)

Absente de cet inventaire jusqu'au 24/09/2026. Environ 24 000 clés `PAYS:code`,
servies avec `authoritative: false` là où aucun registre national ne répond.
Origines, relevées dans l'historique git et dans les scripts des projets amont :

| Origine | Pays | Données d'origine |
|---|---|---|
| sigalor/iban-to-bic (MIT), `scripts/build-bic-data.ts` | DE, AT, FR, NL, BE, ES, LU | fichiers publiés par les banques nationales et associations : Bundesbank (DE), OeNB (AT), BNB (BE), Betaalvereniging (NL), BCE (FR, ES), **registre de l'ABBL (LU)** |
| schwifty (MIT), import du 08/04/2026 (`9e8e34a8`) | 42 pays, dont NO, SI, **FI**, IT, LT, ES, **PL** | registres nationaux compilés par schwifty : **EWIB de la NBP (PL)**, **Finance Finland (FI)**, OeNB (AT), etc. |
| SIX BankMaster | CH | voir plus haut |
| clés dérivées de `bic_entries` (`51f86e96`) | GB, IE et les autres pays dont le code banque de l'IBAN est alphabétique | les sources de `bic.sqlite` |
| ajouts manuels (`e6a99891`, `f954275d`, corrections datées) | quelques clés par pays | sources citées dans chaque commit |

**Clés CZ, 25/09/2026** : les 36 clés tchèques ont été confrontées au číselník
de la ČNB (édition 254). Deux nommaient des codes supprimés, `CZ:4000` (Expobank
CZ puis Max banka, supprimé le 09/04/2025 à la fusion avec Banka CREDITAS) et
`CZ:8280` (supprimé le 01/12/2024) : retirées du fichier. Les 34 autres portent
le BIC que la ČNB publie pour le code. `pruneStaleNationalCodes()` et la garde
de `lookupByCountryBank()` (`src/lib/bic-lookup.ts`) empêchent qu'une
reconstruction du fichier ou une nouvelle édition les ramène.

**Clés IT, 25/09/2026** : les 454 clés italiennes ont été confrontées aux registres
de la Banca d'Italia (édition du 23/09/2026). 286 nomment un code en vigueur ;
8 un code que les registres ne listent pas (Poste Italiane, le Trésor, des
succursales d'établissements européens : une absence ne prouve rien, elles
restent) ; **160 un code que la Banca d'Italia a radié**, dont `IT:03111`, qui
servait « Banca Carige » pour le code d'UBI Banca, absorbée par Intesa Sanpaolo
en 2021 : ces 160 clés sont retirées du fichier. `pruneRetiredItalianCodes()` et
la garde de `lookupByCountryBank()` (`src/lib/bic-lookup.ts`) empêchent qu'une
reconstruction du fichier ou une nouvelle radiation les ramène.

Les licences MIT de sigalor et schwifty couvrent leurs compilations, pas les
droits des éditeurs nationaux. **Décision du 24/09/2026 : les clés AT, BE, LU,
PL et FI sortent du dépôt public** (conditions non établies, non commerciales,
ou permission limitée à l'API : ABBL, voir la section ABBL plus bas). **Fait le
25/09/2026** : 5 454 clés retirées. Le même jour, décision de la session
principale : pas de perte de service, les clés PL, FI et LU et la liste
finlandaise sont servies par la surcouche (membres `map_pl`, `map_fi`, `map_lu`
et `register_fi`, venus après la première surcouche : un fichier écrit avant eux
les laisse « absents », sans refus ni alerte). Sans surcouche, un code polonais
ou finlandais répond `unavailable` / `no_reference_data_for_country` (non
consulté). Les
autres pays tirés de schwifty restent à vérifier un par un. Détail et
attributions : `NOTICE`.

## Hors dépôt, délibérément

**Vocalink — table de contrôle modulo britannique** (`valacdos.txt`,
`scsubtab.txt`), téléchargée à la construction de l'image par
`scripts/seed-uk-modulus.ts`.

🚨 **Ne doit jamais entrer dans le dépôt ni dans un paquet publié.** Vérifié le
22/08 : absente du dépôt, absente de l'historique, absente du paquet npm du SDK
(4 fichiers packés : README, deux fichiers `dist`, manifeste). Le Dockerfile
tolère l'échec de ce téléchargement : un lien pourri doit coûter le contrôle
britannique, jamais le déploiement.

**La famille « sous conditions » — surcouche privée** (étape 3 de la sortie des
données, 25/09/2026). Décision de Claude-Alain du 24/09/2026 : tout ce qui n'est
pas redistribuable sort du dépôt public, l'ONU est gardée hors du dépôt, la
Slovaquie reste publique (la Tchéquie aussi, conditions de la ČNB ci-dessous ;
l'Italie aussi, open data CC BY 4.0 de la Banca d'Italia, ci-dessous). La
liste des membres vit en UN endroit,
`src/lib/restricted-family.ts` (extraction, chargeur et seeders la lisent) :

| Base | Membre | Lignes |
|---|---|---|
| `bic.sqlite` | `eba_step2`, `nbp`, `oenb` | `bic_entries` de ces trois sources |
| `bic.sqlite` | `register_at`, `register_be`, `register_sm` | `national_bank_codes` de ces trois pays |
| `bic.sqlite` | `pra` | `pra_banks` entière |
| `compliance.sqlite` | `un` | `sanctioned_entities` de la liste `UN` |
| `compliance.sqlite` | `epc_sepa`, `epc_vop` | `sepa_participants` et `vop_participants` entières |
| `bic.sqlite` | `map_pl`, `map_fi`, `map_lu` (depuis le 25/09/2026) | `curated_bank_codes` : les clés PL, FI et LU de la carte composite |
| `bic.sqlite` | `register_fi` (depuis le 25/09/2026, liste statique) | `fi_monetary_codes` entière : la liste de Finance Finland |

Les quatre derniers membres sont venus après la première surcouche publiée
(`mayBeAbsent`) : un fichier écrit avant eux ne les porte pas, et le chargeur les
lit « absents » (ni servis ni refusés, sans alerte) au lieu de refuser le fichier.
Un membre déjà servi qui deviendrait absent reste une perte : le rechargement garde
ce qu'il sert et la porte du manifeste refuse la release (`lost_member`). Les clés
viennent chaque mois de la dernière publication de mdomke/schwifty sur PyPI
(`scripts/seed-curated-map.ts`, empreinte SHA-256 de la roue vérifiée contre
l'index) ; la liste finlandaise, statique (un PDF transcrit à la main), est
recopiée telle quelle d'une surcouche à l'autre et ne change que par un geste
manuel (`FI_LIST_PATH`).

Hors de cette constante, retirés à l'étape du retrait (25/09/2026, règle de la
décision du 24/09/2026 « tout ce qui n'est pas redistribuable sort », groupe C de
`NOTICE`) : les clés AT, BE, LU, PL et FI de la carte composite
`src/db/bic_data.json` et la liste transcrite de `src/lib/fi-register.ts` (les
clés PL, FI et LU et la liste sont redevenues des membres le même jour, voir
ci-dessus ; les clés AT et BE, non : les registres de la surcouche répondent), les
exports AT, BE et SM du site,
les blocs EPC des exports et des réponses d'exemple suivies (`frontend/data/countries.json`,
`captured-iban.json`, `mcp/fixtures/api-answers.json`, `sdks/fixtures/quickstart-api.json`,
les fixtures des SDK .NET et Java, la documentation du site), et les entrées GB (FCA) de
`scripts/data/eu-emi-register-2026-05-22.json`. `six_group` reste public : ses lignes
viennent du fichier Bank Master de SIX (« may be used freely »).

- **Deux fichiers privés**, un par base, désignés par `RESTRICTED_BIC_OVERLAY_PATH`
  et `RESTRICTED_COMPLIANCE_OVERLAY_PATH` (chemins absolus, sur le disque du
  serveur, jamais dans un dépôt). Chacun porte les tables de la famille, créées
  depuis les définitions de la constante, plus `overlay_meta` (format, base, date,
  générateur, empreinte de la base lue, et selon la base `source_last_refresh` =
  `metadata.last_refresh` de la conformité lue, ou `source_bic_entries_updated_at`
  = la plus récente date de chargement de `bic_entries` de la base BIC lue) et
  `overlay_members` (par membre : lignes, empreinte du contenu, date de chargement
  des lignes quand la table en porte une, `as_of` ou mois de liste, source ; aucune
  date de chargement pour AT, BE et SM, que personne ne date).
- **Fusion au démarrage, la donnée la plus fraîche servie membre par membre** :
  `entrypoint.sh` recopie les bases publiques à chaque démarrage ; l'API copie la
  base publique fraîche à côté du fichier privé et décide pour chaque membre :
  la surcouche sert si la base publique n'a aucune ligne du membre, si la
  surcouche est strictement plus récente (datée de la même façon des deux côtés :
  `last_refresh` pour la conformité, plus récent `updated_at` pour OeNB, NBP et
  EBA STEP2 décidés ensemble, mois de liste puis `updated_at` pour la PRA, `as_of`
  pour SM), ou si les contenus sont identiques ; sinon les lignes publiques sont
  gardées (`kept_public`, sans alerte : c'est un rafraîchissement public plus
  récent). AT et BE, non datés, restent donc publics dès qu'ils diffèrent. Le
  `last_refresh` servi n'est jamais plus frais qu'un membre servi par la
  surcouche. La base publique n'est jamais modifiée.
- **Contrôles** : intégrité SQLite, version du format (2), base attendue, aucune
  vue ni déclencheur, aucune table inconnue ni ligne hors de la famille (sinon
  fichier refusé) ; pour chaque membre, table et colonnes identiques à la
  constante, plancher de lignes (ceux des seeders pour AT, BE, SM et PRA), compte
  et empreinte du contenu (sinon membre refusé, les autres servis). Le SQL lu dans
  la surcouche n'est jamais exécuté. Refus : raison au journal, alerte
  d'exploitation `overlay:<base>`. `GET /health` → `restricted_overlays`.
- **Dernière surcouche acceptée** : gardée à côté du fichier privé
  (`restricted-<base>.accepted.sqlite`). Au démarrage, si le fichier de la variable
  est refusé (entier ou en partie), elle est fusionnée avec la base publique
  fraîche et servie à sa place (`fallback: true` dans `/health`, alerte rouge) ;
  sans elle, base publique seule et « non consulté » là où la donnée manque.
- **Rechargement sans redémarrage** : un fichier remplacé (dépôt par un fichier
  voisin puis `mv`) est vu en dix minutes au plus, et seule sa base est
  refusionnée. Un fichier refusé, ou qui cesserait de servir un membre servi
  aujourd'hui, laisse la surcouche courante en service ; il n'est pas reconstruit
  aux passages suivants tant qu'il ne change pas. Après avoir libéré un volume
  plein, redéposer ou redémarrer.
- **Retirer ou déplacer une surcouche** : retirer la variable, redémarrer,
  vérifier `off` dans `/health`, puis effacer dans le dossier de l'ancien fichier
  privé `restricted-*.merged-*.sqlite*`, `restricted-*.accepted.sqlite` et, si
  l'on renonce, la surcouche elle-même. Sinon environ 36 Mo et une copie complète
  de la famille restent sur le volume, et une variable reposée plus tard
  reprendrait l'ancienne copie acceptée. Effacer le seul fichier privé n'est PAS
  un retour arrière : la fusion déjà faite reste servie jusqu'au redémarrage.
- **Extraction sans téléchargement** : `npm run overlay -- extract --bic <copie>
  --compliance <copie> --out-dir <dossier hors de tout dépôt git>` (crée le
  dossier en 0700 ; refuse tout dépôt git ou copie de travail, un lien ou un lien
  dur en sortie ; lit des copies ; refuse sous un plancher ou sur une baisse de
  plus de 10 % d'un membre d'au moins 50 lignes sans `--allow-shrink`). Contrôle :
  `npm run overlay -- check`.
- **Seeders à sortie choisie**, pour le futur dépôt privé de rafraîchissement :
  `BIC_DB_PATH` (enrich, national, PRA), `COMPLIANCE_DB_PATH` (conformité),
  `SEED_FAMILY=restricted` (la famille seule), enchaînés par
  `npm run overlay:seed -- --kind bic|compliance --out <fichier>`. La sortie doit
  être hors de tout dépôt (`$RUNNER_TEMP` en CI), et `overlay:seed` pose
  `SEED_TMP_DIR` dans son dossier de travail : les téléchargements et la base de
  conformité en construction ne passent plus par `.tmp-bic-enrich/` et
  `.tmp-compliance/` du checkout (désormais ignorés par git). Sans ces variables
  (`SEED_FAMILY` vaut `public` par défaut depuis le 25/09/2026), les workflows publics
  écrivent des bases sans la famille et ne téléchargent aucun de ses membres.

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
- **Une seule attribution nommée, et elle est contractuelle** (posée le
  25/08/2026, en même temps que la donnée) : « Bank of England (List of Banks,
  \<mois\>) ». Elle figure sur le pied de page et le bandeau d'accueil dans les
  trois langues, sur les trois `llms.txt` (API + `frontend/public/llms.txt` +
  `frontend/public/llms-full.txt`) et dans les trois pages
  `docs/data-sources.mdx`. Sur le `llms.txt` de l'API le mois est **lu de la
  base** (`praAttribution()`), sur les fichiers statiques il est **épinglé par
  un test de garde** (`src/routes/pra-attribution.test.ts`) qui compare la
  chaîne écrite au `list_month` réellement chargé — sans quoi le mois pourrirait
  en silence au premier rafraîchissement, ce qui serait une violation de la
  permission et pas un simple défaut de fraîcheur.
- **Aucune autre licence n'est nommée sur aucune surface publique.**

## Ce qui reste à faire, par ordre de risque

1. **Établir les licences encore marquées ❌.** Six sur treize sont établies :
   GLEIF (CC0 pour les LEI, 23/08 ; licence SWIFT de la table BIC↔LEI, 24/09),
   Bundesbank, SIX BankMaster (23/08), puis **UE (CC BY 4.0)**, **OFAC
   (§105)** et **ONU** (24/08). **SwiftCodes n'en fait plus partie depuis le
   24/09/2026** : la MIT vient de l'auteur du dépôt, les droits de SWIFT ne
   sont pas établis (groupe B de `NOTICE`). Au 24/08, restaient **EBA
   Clearing** (« all rights reserved », aucun grant), **NBP**, **EPC** et le
   **GAFI** — les trois derniers derrière des murs anti-robot, voir la mesure
   ci-dessous. La position sur l'ONU est arrêtée depuis le 24/08 (voir la
   section citations), et une demande de permission est PARTIE à la FCA le
   même jour (`firm.queries@fca.org.uk`, leur adresse « Write to us »).

   ### 🚨 Le goulot est l'ACCÈS, pas le temps de lecture — mesuré le 24/08/2026

   Ces pages sont publiques et gratuites, et pourtant la moitié se refuse à
   toute lecture programmatique. Relevé en interrogeant chaque URL avec un
   User-Agent de navigateur réel :

   | Page de conditions | Mesure du 24/08 |
   |---|---|
   | Commission européenne | ✅ lue — **CC BY 4.0**, Décision du 12/12/2011 |
   | GAFI (`fatf-gafi.org/en/pages/terms-and-conditions.html`) | ✅ **lu le 26/08 via le navigateur de Claude-Alain** — data : commercial permis avec attribution |
   | EPC (`europeanpaymentscouncil.eu/terms-use`) | ✅ **lu le 26/08 (navigateur C-A)** — non commercial par défaut → lettre |
   | NBP (`nbp.pl/en/terms-of-use/`) | ✅ **lu le 26/08 (navigateur C-A)** — personnel non commercial → couvert par la lettre EWIB |
   | OFAC / Treasury | ⏳ joignable, la bonne page de conditions reste à situer |
   | EBA Clearing | ⏳ site joignable en 200 ; c'est l'URL de la page participants qui a changé, **pas** un 403 comme noté le 23/08 |

   ⚠️ **Un 200 n'est pas une preuve d'accès.** `nbp.pl/en/terms-of-use/` répond
   200 et sert un écran de détection de robot. Vérifier le CONTENU, jamais le
   code de statut : c'est exactement l'erreur que la règle « ne jamais annoncer
   sans la preuve » existe pour attraper.

   ⚠️ **Le contournement par archive n'existe pas ici** : `web.archive.org` est
   bloqué au niveau du harnais, pas du site.

   **Conséquence pour l'arbitrage :** un mur anti-robot ne dépend pas du modèle
   qui interroge. Aucune montée en puissance ne débloque ces quatre pages —
   seul un navigateur le fait. Les ranger parmi les tâches « à faire faire par
   un agent plus capable » serait une erreur de diagnostic.
2. ✅ **Pied de page aligné le 22/08/2026** — voir la section ci-dessus.
3. **Décider si les licences doivent être publiées.** Pour un acheteur qui
   passe par un service achats, une page qui nomme ses sources et leurs
   conditions est un argument ; son absence est une question de plus à traiter
   par mail.

## Piste GB — instruite le 24/08/2026, les deux sources sont « permission d'abord »

Le Royaume-Uni est le seul pays où une source nouvelle paierait vraiment (le
plus gros usage réel, zéro donnée d'institution autoritative — seul le modulus
Vocalink tourne). Les deux candidates ont été lues à la source :

**Bank of England / PRA — « List of Banks ».** Un CSV mensuel, ~300 banques
agréées, colonnes Firm Name / FRN / **LEI** (donc joignable à notre base GLEIF
sans heuristique de noms). Techniquement idéal. Mais **aucune mention de
licence** ni sur la page ni dans le fichier, et les conditions générales du
site disent :
> « You may (and unless otherwise specifically stated, such as in the case of
> the Rulebook and the Database […]) download, display or print the Resources
> for personal use or internal use within an individual organisation for
> **non-commercial purposes**. »
> — <https://www.bankofengland.co.uk/legal>

L'exception Open Government Licence du site vise la **Database statistique**
(« Reproduction of data in the Database is subject to the terms of the UK Open
Government Licence ») — pas les listes de firmes. Défaut = non commercial.

**FCA — Financial Services Register.** Les conditions générales interdisent
explicitement notre cas :
> « You must not use data from this site to provide a **data feed** to any
> comparison table or any other website without our written permission. »
> — <https://www.fca.org.uk/legal>

L'API du registre a peut-être ses propres conditions (la leçon SIX/Bundesbank :
la bonne règle n'est pas dans les CGU générales) — mais la page développeur
(`register.fca.org.uk/Developer/s/`) est une application Salesforce qui ne rend
**rien** sans JavaScript : à lire dans un navigateur, comme GAFI/EPC/NBP.

**Conclusion : la piste GB passe par une demande de permission écrite**, pas
par un import. Les deux demandes sont parties le 24/08/2026.

### ✅ 07/09/2026 — la FCA accepte l'usage décrit (Register API)

Après le détail de l'usage envoyé le 07/09 à 07 h 31 UTC (une requête = une firme, bloc nom / FRN /
statut / crédit « Source: FCA Financial Services Register » / date de récupération, ni comparateur ni
liste ni copie en masse, cache ≤ 24 h, pas d'endorsement, volume individuel sous les limites), le
Register Team a répondu le même jour à 07 h 39 UTC :

> « Based on what you've described, your approach is acceptable provided that usage remains in line with
> the Register API Terms of Use (See Register Terms of Use) and the applicable rate limits (which can be
> viewed in the API developer portal). We do not disallow using the data for commercial purposes. »

Quatre conditions, à porter dans le code le jour du branchement et rappelées dans notre remerciement du
même jour : (1) les Terms of Use du registre et les limites de débit publiées dans le portail, sans
contournement ; (2) **aucun usage marketing** (« using the data to target or market to entities contained
within the dataset ») ; (3) **nous sommes responsables de traitement (GDPR) pour la donnée reçue** ;
(4) exclusion de responsabilité de la FCA. Le service est une bêta throttlée, sans SLA, avec une API
améliorée annoncée pour 2027 et ses propres conditions le moment venu.

Ce que cela permet : le registre des firmes agréées (banques, EMI, PI, milliers d'entrées) servi **par
requête**, à la manière du bloc `pra_authorisation`, avec le crédit et la date sur chaque réponse.
Préalable technique : un compte sur le portail FS Developer (l'e-mail devient l'identifiant d'API), clé
posée sur Railway (`FCA_REGISTER_API_KEY`). La liste PRA de la Bank of England reste la source des ~300
banques ; le Register couvre le reste.

**07/09/2026 — branchement construit, en attente de la clé du portail.** `GET /v1/gb/firm/:frn`
(`src/routes/gb-firm.ts`, client et cache dans `src/lib/fca-register.ts`) est écrit, testé sans réseau et
documenté (OpenAPI `lookupGbFirm`, `/docs/gb-firms` EN/FR/DE, llms.txt). Tant que `FCA_REGISTER_API_KEY`
et `FCA_REGISTER_API_EMAIL` (l'e-mail du compte, identifiant de l'API) ne sont pas posées sur Railway, la
route répond `503 not_configured` avant toute lecture de clé ou de paiement, et n'apparaît pas dans la
table x402. Les quatre conditions sont dans le code : espacement des appels (une requête en vol, 1 100 ms
entre deux, une seule attente sur 429 — 🚨 constante à aligner sur la limite publiée dans le portail le
jour de la clé ; les clients tiers rapportent dix requêtes par dix secondes) ; test `marketing-guard`
qui rougit si un module CRM ou de prospection importe le client ; seule la ressource `/Firm/{frn}` est
appelée, jamais `/Individuals` ; exclusion de responsabilité de la FCA sur chaque réponse. Schéma confirmé
sans le portail (SPA illisible) par trois clients open source qui enregistrent de vrais échanges :
CyborgFinance/FCARegisterLaravel (en-têtes `x-auth-email` / `x-auth-key`, exemple `Firm/{FRN}`),
release-art/fca-api (table des codes `FSR-API-02-01-00` trouvé / `-11` absent / `-21` requête invalide,
échanges du 27/02/2026), craigpotter/fca-php-sdk (absence enregistrée le 14/06/2023 : HTTP 200,
`Data: null`). Une absence est servie `200 found:false`, facturée et mise en cache comme une réponse
(un 404 serait remboursé par le middleware de clé et jamais réglé par x402 : chaque absence gratuite
ferait de la route un balayeur de l'espace des FRN aux frais du registre). **Tranché le 07/09 au soir :
la marge « stale » est à zéro** (`FCA_STALE_GRACE_MS = 0`) : l'usage décrit à la FCA dit « cache ≤ 24 h »,
donc une copie de plus d'un jour n'est jamais servie, panne ou pas — la route répond 502 et dit que le
registre est indisponible. Rouvrir la marge suppose d'écrire d'abord à la FCA.

### ✅ 08/09/2026 — la Hellenic Bank Association accepte la réutilisation commerciale des fichiers HEBIC

Lettre du lot 2 partie le 08/09 à 10 h 40 UTC (adresse générale de la HBA) ; réponse d'un Senior Director de
l'association à 11 h 16 UTC, trente-six minutes plus tard :

> « Indeed, IBANforge can reuse HEBIC files in its API responses normalised and credited as "Source: Hellenic
> Bank Association (HEBIC)" explicitly stating the following Important Note "HBA is not responsible for the
> accuracy of the data given by the banks. HBA has the right to make any adjustments when necessary and is not
> responsible for any misuse of the Greek Banking System (HEBIC) index". »

Deux conditions, à porter dans le code le jour du branchement : (1) le crédit exact « Source: Hellenic Bank
Association (HEBIC) » ; (2) **l'Important Note reproduite en entier** sur
chaque réponse qui sert une donnée HEBIC (champ `notice` du bloc registre, jamais résumée) et dans la
documentation. Remerciement envoyé le 08/09 avec le rappel des deux conditions.

**Précision de la HBA reçue le 14/09/2026 : le fichier est partiel pour les émetteurs d'IBAN grecs.**
Les codes HEBIC ne sont pas attribués aux établissements de paiement et de monnaie électronique qui
émettent des IBAN grecs. Pour leurs codes à trois chiffres, la HBA renvoie à la Bank of Greece,
autorité compétente : <https://www.bankofgreece.gr/en/main-tasks/supervision/supervised-institutions>.
Ce renvoi ne constitue ni une liste complète déjà vérifiée ni une autorisation de réutiliser une autre source.

Ce que le fichier permet : confirmer l'établissement et l'adresse associés à un code bancaire présent
(positions 5 à 7 de l'IBAN). **Une absence ne prouve jamais que le code n'existe pas.** L'intégration doit
donc suivre `NON_EXHAUSTIVE_REGISTERS`, avec `authoritative: false`, sans verdict `not_allocated` déduit
de cette seule absence. Le fichier des agences est distinct ; la présence du code bancaire ne valide pas
les chiffres de l'agence. Source : <https://www.hba.gr/info/hebicmap>.

**Édition, pas date inventée.** La HBA confirme le 14/09 qu'elle ne fournit aucune date exacte de publication.
La page nomme l'édition « 2026 B' τρίμηνο » (2026 T2), encore visible à la relecture du 14/09. Citer
l'édition et la date de consultation, en les distinguant ; ni la réponse reçue ni la consultation ne sont
la date de publication du fichier.

Le chantier grec existe sur des branches locales, mais HEBIC n'est pas encore intégré à `main` au
14/09/2026. La bascule vers le traitement partiel reste une condition préalable à l'intégration par la
session responsable des registres ; ne pas relancer ni publier les anciennes branches autoritatives.

### ✅ 10/09/2026 — Betaalvereniging Nederland confirme la réutilisation de sa liste BIC

Réponse initiale du 31/08/2026, retransmise le 10/09 et relue le 14/09 : la liste BIC peut être utilisée
gratuitement, sans accord de licence formel, avec **attribution à Betaalvereniging Nederland** et une
**mise en garde indiquant qu'un BIC ou un code bancaire peut être modifié, retiré ou ajouté à tout moment**.
L'association ne garantit pas l'exactitude permanente de la liste. Ces conditions devront accompagner
les données lors de leur utilisation ; cette permission n'établit pas à elle seule l'exhaustivité du registre.

L'association indique que son flux RSS constitue le seul historique des changements et qu'il remonte
à au moins treize mois au moment de sa réponse. Ne pas en déduire une profondeur historique garantie
ou une archive complète disponible depuis une autre source. La présente entrée consigne les conditions ;
elle ne déclare aucun nouvel import ni modification de l'API.

### ✉️ 16/09/2026 — quatre lettres parties (OeNB, BNB, Finance Finland, EBA CLEARING), et la position en attendant

Décision de Claude-Alain du 16/09/2026 sur l'audit du jour (« on assume et on écrit, on avisera ensuite selon
les réponses ») : les quatre registres servis sans condition d'usage lue reçoivent le même modèle de lettre que
la Bank of England, la Slovaquie et la Grèce (qui a marché trois fois sur trois). Envoyées le 16/09 au soir depuis
`claude-alain@ibanforge.com` par le relais du CRM, consignées dans l'espace Correspondances (quatre correspondants
créés) :

| Destinataire | Adresse | Objet de la demande |
|---|---|---|
| Oesterreichische Nationalbank | oenb.info@oenb.at | permission de réutiliser le SEPA-Zahlungsverkehrs-Verzeichnis (CSV), la licence data.gv.at s'applique-t-elle, formule d'attribution |
| Banque nationale de Belgique (Protocol Secretariat) | info@nbb.be | permission de réutiliser la liste des bank identification codes, formule d'attribution |
| Finance Finland | ffi@financefinland.fi | permission de réutiliser la liste des codes d'établissements monétaires, attribution, notification des nouvelles éditions ou forme lisible par machine |
| EBA CLEARING | clearing@ebaclearing.eu | permission d'utiliser la liste des STEP2 SCT reachable PSPs comme source de l'annuaire BIC ; une **précision** envoyée quelques minutes après la première lettre, qui décrivait l'usage de façon trop large (« réponse SEPA ») : la liste sert de source de noms pour des BIC qu'aucun autre annuaire ne nomme, moins de deux cents |

Position tant qu'aucune réponse n'est arrivée : les quatre sources restent servies **avec crédit et date**, rien
n'est redistribué ni altéré ; une réponse négative entraîne le retrait des lignes concernées, comme pour
AusPayNet. Bulgarie : rien à demander, la BNB a déjà répondu (27/08, ci-dessus dans le tableau). Réponses à
surveiller dans l'entrant (le CRM les rattache aux correspondants).

### ⛔ 03/09/2026 — AusPayNet refuse la réutilisation du répertoire BSB

Refus explicite, relu le 14/09/2026, de l'usage proposé : extraire le CSV BSB public, le normaliser et
redistribuer ses données dans l'API commerciale IBANforge, même avec attribution. AusPayNet invoque les
conditions de son site et son rôle de gestionnaire des codes.

**Aucune donnée issue de ce fichier ne doit être importée, stockée ou servie par IBANforge.** Ne pas
traiter AusPayNet comme un registre autoritatif ni contourner le refus par une copie du même fichier.
Cette interdiction porte sur cette source et cet usage ; elle ne préjuge pas des droits d'une autre
source australienne indépendante, qui exigerait sa propre vérification. Aucune intégration BSB n'est
introduite par cette mise à jour documentaire.

### ✅ 25/08/2026 — la Bank of England a accordé la permission

Réponse du service Engagement and Enquiries de la Bank of England, reçue le
25/08/2026 :

> « The information is publicly available on the Bank's website, and we have
> no objection to the use you describe, provided appropriate attribution to
> the Bank of England is maintained. »

Le périmètre couvert est celui décrit dans la demande et repris mot pour mot
dans leur réponse : la **List of Banks mensuelle de la PRA comme source de
référence dans le service d'API**, avec attribution à la Bank of England
**et au mois de publication de la liste**. La permission est donc
conditionnelle et son périmètre est précis — un usage qui sortirait de cette
description (revente du fichier brut, par exemple) n'est pas couvert.

✅ **Ingestion faite le 25/08/2026, avec l'attribution posée dans le même
commit** — c'était la condition du oui, pas une étape suivante.

- `scripts/seed-pra-banks.ts` (`npm run db:seed-pra`) télécharge
  `banks-list-YYMM.csv`, remonte jusqu'à deux mois en arrière si le mois courant
  n'est pas encore publié, et **abandonne sans rien casser** (log + sortie 0,
  table intacte) si le téléchargement, le parse ou le plancher de cohérence
  échoue — même doctrine que Vocalink plus haut. Il ne droppe jamais la table
  avant d'avoir un parse complet en main.
- Table `pra_banks` dans `data/bic.sqlite` : 281 établissements en 2026-08,
  quatre sections (`uk_incorporated` 148, `non_uk_branch` 120,
  `gibraltar_branch` 6, `eea_sro_branch` 7). Le mois est **lu du préambule du
  fichier** (« List of PRA-regulated Banks as at  01 August 2026 », deux espaces
  après « at »), jamais de l'horloge : une attribution au mauvais mois est la
  seule erreur irrattrapable de ce chantier.
- Servi dans `pra_authorisation` sur `/v1/bic/:code` et sur la validation d'un
  IBAN GB. **Jointure par LEI uniquement, jamais par nom.**
- 🚨 **La section des succursales publie le LEI du SIÈGE** (son en-tête de
  colonne le dit : « Head Office LEI »), et GLEIF rattache ce LEI à tous les BIC
  de la maison mère dans le monde. Mesuré sur la base réelle au moment de
  l'ingestion : une jointure LEI sans portée touchait **1 100 lignes BIC hors
  GB/GI** — autant de réponses payantes annonçant un agrément britannique sur un
  BIC de Francfort ou de Tokyo. Le bloc n'est donc servi que pour les BIC **GB**
  (plus **GI** pour la section Gibraltar).
- **Aucune branche négative.** Le préambule du fichier dit lui-même qu'il « does
  not supersede the Financial Service Register », et la liste ne couvre qu'un
  agrément (recevoir des dépôts). Une absence ne produit **aucun bloc**, jamais
  `authorised: false`.

La FCA, elle, a accusé réception le 24/08 (dossier ouvert, réponse de fond
promise sous 2 jours ouvrés) — son registre des firmes est un périmètre
distinct de la liste des banques, les deux démarches restent utiles.

## EBA — registre PSD2 des établissements de paiement et de monnaie électronique

Ingéré le 26/08/2026. La « copie d'or » que l'EBA republie chaque jour :
329 122 entités, dont 4 416 agréments utiles sur 30 pays.

**Licence.** « Reproduction of all EBA material on this site is authorised,
provided the source is acknowledged » — <https://www.eba.europa.eu/legal-notice>.
L'attribution est la condition, donc `source` et `as_of` sont des **colonnes
stockées** servies sur chaque surface, jamais des littéraux : la copie change
tous les jours, une date écrite en dur est une attribution périmée dès le
lendemain.

**Intégrité — la seule source du corpus qui se prouve.** Le manifeste
(`euclid.eba.europa.eu/register/api/filemetadata`) publie le SHA-256 du ZIP du
jour, et le ZIP contient un second SHA-256 pour le JSON qu'il transporte. Le
seeder vérifie **les deux**. Un écart laisse `psd_entities` intacte et sort en 0
— même doctrine que la PRA : un téléchargement tronqué ne remplace jamais de
bonnes lignes.

**Volumétrie.** Le JSON pèse 217 Mo une fois décompressé, ce qui exclut un
`JSON.parse`. Le seeder scanne le flux d'inflate en comptant les accolades et
n'émet qu'une entité à la fois (`DepthTwoScanner`). Il ne s'appuie pas sur
l'indentation : un reformatage en amont viderait silencieusement un lecteur
ligne à ligne.

**Ce qui est gardé.** 5 types sur 9. `PSD_AG` (322 467 agents, 98 % du fichier)
n'émet pas d'IBAN ; `PSD_BR` (succursales) ne porte **aucun** code national —
mesuré : 0 sur 244, la jointure serait impossible par construction ;
`PSD_EXC` et `PSD_ENL` ne sont pas des agréments.

| type EBA | stocké comme | lignes |
|---|---|---|
| `PSD_EPI` | `exempted_payment_institution` | 2 758 |
| `PSD_PI` | `payment_institution` | 1 014 |
| `PSD_EMI` | `emi` | 427 |
| `PSD_AISP` | `aisp` | 129 |
| `PSD_EEMI` | `exempted_emi` | 88 |

### 🚨 Le fichier n'a NI BIC NI LEI — et un seul pays est servi

Vérifié exhaustivement sur les 217 Mo : les entités portent treize clés de
propriétés, **aucune n'est un identifiant que cette API sait déjà joindre**. La
seule jointure candidate vers un IBAN est donc `pays + code national de
référence` — or ce code est celui sous lequel l'autorité nationale classe un
agrément, ce qui n'est presque jamais le code que porte l'IBAN du pays.

Mesuré pays par pays contre les codes banques que nous détenons déjà (carte
curée, BLZ Bundesbank, registres AT/BE) :

| pays | lignes | largeur code IBAN | conformité de format | recouvrement | verdict |
|---|---|---|---|---|---|
| **ES** | 112 | 4 | **100 %** | 1, et il concorde | ✅ **SERVI** |
| PT | 17 | 4 | 82 % | 0 | écarté |
| HR | 21 | 7 | 19 % | 0 | écarté |
| PL | 2 449 | 8 | 0 % | 0 | écarté — NIP (10 chiffres) |
| NL | 226 | 4 | 0 % | 0 | écarté — référence DNB `R203521` |
| CZ / SK | 179 / 16 | 4 | 0 % | 0 | écarté — IČO (8 chiffres) |
| LT | 178 | 5 | 0 % | 0 | écarté — `LB000237` |
| FR | 130 | 5 | 0 % | 0 | écarté — SIREN (9 chiffres) |
| DE | 95 | 8 | 0 % | 0 | écarté — n° BaFin (6 chiffres), pas la BLZ |
| MT / IE | 91 / 70 | 4 | 0 % | 0 | écarté — `C106255`, `C58301` |
| IT | 80 | 5 | 0 % | 0 | écarté — codice fiscale (11) |
| CY | 52 | 3 | 0 % | 0 | écarté — `115.1.2.5` |
| LU | 39 | 3 | 0 % | 0 | écarté — `Z00000035` |
| AT | 9 | 5 | 0 % | 0 | écarté — n° FMA `481488x` |
| SE, FI, DK, BE, NO, LV, EE, HU, BG, RO, GR, SI, IS, LI | — | — | 0 % | 0 | écarté — n° d'entreprise ou fiscal |

**Pourquoi l'Espagne est démontrée, et pas seulement plausible :**

1. Les 112 codes espagnols font **exactement 4 chiffres**, la largeur qu'un
   IBAN ES porte en positions 1-4.
2. Les plages suivent les types **sans exception** : 67xx = les 12 `PSD_EMI`,
   68xx/69xx = les établissements de paiement et AISP, 86xx-88xx = des entités
   dont les noms publiés se terminent **tous** par « E.F.C. » (Establecimiento
   Financiero de Crédito). Ce dernier point est décisif : il est confirmé par le
   texte du registre lui-même, sans référence à nos données. C'est bien le
   **código de entidad du Banco de España** qui est publié ici.
3. Les banques espagnoles vivent en 0xxx-3xxx. **Zéro** des 112 codes PSD n'y
   entre — les plages sont disjointes, donc ce registre ne peut pas décrire une
   banque comme un établissement de paiement.
4. Le seul code présent des deux côtés concorde : 6717 = « BNEXT ELECTRONIC
   ISSUER, E.D.E. » ici et `BNXTESM2` dans notre carte curée, construite
   indépendamment. L'autre clé espagnole hors plage bancaire que nous
   détenions, 6723 (Modulr Finance B.V. Sucursal en España), est absente pour
   une raison **structurelle et non contradictoire** : c'est une *succursale*,
   et les succursales sont des lignes `PSD_BR`, qui ne portent aucun code.

Le Portugal est le meilleur candidat suivant et reste écarté : 4 chiffres, la
bonne largeur, mais 17 entités, aucun recouvrement, et des codes éparpillés sur
1800/32xx/75xx/81xx/82xx/87xx au lieu de la plage réservée unique que montre
l'Espagne. **Plausible n'est pas démontré.** Malte est écarté pour une raison
plus tranchante : un code banque maltais *est* une abréviation à 4 lettres du
nom de l'établissement, donc les deux abréviations MFSA qui « matchent » sont
exactement la coïncidence de nom que `pra-banks.ts` refuse de joindre.

### Ce qui est servi

- `scripts/seed-eba-psd.ts` (`npm run db:seed-psd`), branché sur
  **`refresh-bic.yml`** (mensuel) et non sur le `refresh-compliance.yml`
  hebdomadaire : `psd_entities` vit dans `data/bic.sqlite`, or le workflow
  hebdomadaire ne stage que `data/compliance.sqlite`. L'y mettre reviendrait
  soit à courser l'autre job sur le même fichier, soit — pire, parce que c'est
  silencieux — à semer une table jamais commitée.
- Bloc `psd_registration` sur la validation d'un IBAN : `entity_type`, `name`,
  `country`, `competent_authority`, `source`, `as_of`. **`source` et `as_of`
  sont obligatoires et verrouillés par un test** qui parcourt tous les codes
  servis, pas un échantillon : un bloc sans source est une infraction à la
  licence, pas un champ manquant.
- `issuer.type` peut être **rempli, jamais écrasé** : seule une classification
  `default` — une hypothèse, pas un constat — cède la place, et la nouvelle
  valeur `classification: 'register'` dit d'où vient le verdict. Seuls `emi` et
  `payment_institution` bougent un type d'émetteur ; un AISP n'émet rien et les
  deux types « exempted » sont des **dispenses** d'agrément, pas des agréments.
- **Aucune branche négative.** Le disclaimer du registre dit lui-même qu'il
  « has no legal significance » et qu'un établissement omis reste agréé. Une
  absence ne produit **aucun bloc**, jamais `registered: false`.
- La mesure est encodée en test contre la table semée : conformité de format
  espagnole ≥ 95 % (seuil), et **zéro** code PSD dans la plage bancaire
  0xxx-3xxx (invariant dur — c'est celui dont l'échec produirait un faux
  positif payant). Un refresh qui dégrade la correspondance rougit.

⚠️ **Le score de `/v1/iban/compliance` bouge pour ces IBAN, volontairement.**
`calculateRiskScore` ajoute +10 pour `emi` et +15 pour `payment_institution`.
Mesuré avant/après sur la base réelle :

| IBAN | avant | après |
|---|---|---|
| ES…6702 (EMI agréé) | `issuer_type: null`, score 10, `low` | `emi`, score 20, `medium`, flag `emi_issuer` |
| ES…6802 (EP agréé) | `issuer_type: null`, score 10, `low` | `payment_institution`, score 25, `medium` |
| ES…2100 (CaixaBank) | `bank`, score 0, `low` | **inchangé** |

C'est la prémisse du produit qui fonctionne, pas une régression : un IBAN émis
par un établissement de monnaie électronique porte un risque de contrepartie
qu'un IBAN bancaire n'a pas, et jusqu'ici les IBAN de monnaie électronique
espagnols étaient notés comme si l'on ne savait rien d'eux. Un établissement de
crédit n'est pas touché. Épinglé par un test, parce que c'est une surface
**payante** et qu'un score qui bouge en silence se remarque chez le client
avant de se remarquer ici.

## ✅ 26/08/2026 — les quatre pages murées, lues par Claude-Alain (captures/collages navigateur)

Les murs anti-robots (403 GAFI/EPC, mur NBP, SPA FCA) sont tombés par le bon
outil : le navigateur de Claude-Alain. Quatre verdicts, cités mot pour mot.

**GAFI / FATF — ✅ EXPLOITABLE, usage commercial expressément permis.**
> « Permitted Use – Except where additional restrictions apply as stated
> above, you can extract from, download, copy, adapt, print, distribute,
> share and embed data for any purpose, **even for commercial use**. You
> must give appropriate credit to the FATF by using the citation associated
> with the relevant data, or, if no specific citation is available […]:
> FATF (year), (dataset name), (data source) DOI or URL (accessed on (date)). »
> — Terms, Conditions and Disclaimers, section 2 « Data », fatf-gafi.org, lu le 26/08/2026

Conditions : attribution au format ci-dessus, à RÉPERCUTER en cascade dans
toute sous-licence ; jamais le logo ; jamais d'implication d'endossement.
Le contenu écrit (hors data) est en CC BY 4.0. Attribution posée le 26/08
sur les pages data-sources publiques (3 langues).

**Formule remplie le 24/09/2026** (l'ancienne formule publiée n'avait ni
l'année ni une date de consultation) :

> FATF (2026), High-Risk and Other Monitored Jurisdictions, FATF public statements of the June 2026 plenary, https://www.fatf-gafi.org (accessed on 10 July 2026).

Elle est construite par `fatfCitation()` à partir de `FATF_AS_OF` (mois de la
plénière) et de `FATF_ACCESSED_ON` (jour de lecture des déclarations du GAFI :
le 10/07/2026, commit `766d711d`, qui a synchronisé les listes sur la plénière
des 17-19 juin), dans `src/lib/compliance-static.ts`. Les trois pages
data-sources et `NOTICE` ne peuvent pas appeler la fonction :
`src/routes/fatf-attribution.test.ts` les épingle sur elle (ce fichier
compris), et échoue si la date de consultation précède l'ouverture de la
plénière (`FATF_PLENARY_OPENED_ON`, le 17/06/2026 pour la plénière de juin).

**EPC — ❌ NON COMMERCIAL par défaut → permission d'abord.**
> « In principle, the information contained in this website can be
> reproduced, redistributed and transmitted for **non-commercial purposes**,
> as long as the EPC as its source is acknowledged. »
> — Disclaimer, europeanpaymentscouncil.eu, lu le 26/08/2026

Vérifié le même jour : les CSV des registres (sct, sct_inst, sdd_core, vop)
ne portent AUCUNE condition interne — le disclaimer du site gouverne.
Les rulebooks exigent une approbation écrite préalable (nous ne les
reproduisons pas). → Demande de permission à écrire à secretariat@epc-cep.eu
(adresse publiée dans le disclaimer), sur le modèle Bank of England.
Les registres EPC alimentent aujourd'hui sepa/vop_participant : statut à
clarifier par la lettre, position documentée ici en attendant.

**NBP — ❌ usage personnel NON COMMERCIAL.**
> « Narodowy Bank Polski makes no objections to saving files, copying pages
> in full or in part or making printouts for personal use, provided that
> they do not serve commercial purposes. »
> — Terms of Use, § 1.6, nbp.pl, lu le 26/08/2026

Nos 21 lignes NBP dans bic.sqlite ne sont pas couvertes par ce texte. La
demande déjà envoyée au helpdesk NBP (26/08, au sujet d'EWIB) couvre la
question ; si la réponse est négative, retirer les 21 lignes.

**FCA Developer — la page des conditions API reste illisible (SPA), mais
l'Accessibility Statement livre un canal : RegisterAPISupport@fca.org.uk.**
La réponse de fond au dossier ouvert (#212491959) reste la voie principale.

## ✅ 07/09/2026 — deux contradictions de l'atlas tranchées (PL, GL)

L'atlas des sources d'août 2026 laissait deux questions ouvertes « à trancher avant toute promesse ».

**Pologne — le code banque de l'IBAN est le numéro de règlement à huit chiffres, pas le
numéro d'institution.** Le RIAD de la BCE identifie une banque polonaise par son numéro
d'institution (trois chiffres, `PL00105` = ING Bank Śląski dans la liste des MFI) ; l'EWIB de la
NBP porte le *numer rozliczeniowy* complet (huit chiffres : trois d'institution, quatre d'unité,
un de contrôle). L'IBAN porte les huit. Position : `bank_code_check.value` reste le numéro de
règlement (positions 5-12 de l'IBAN), vérifié contre la carte composite (`authoritative: false`)
tant que la NBP n'a pas répondu à la demande de réutilisation d'EWIB (26/08, relance prévue
le 10/09). Ce que la carte ne pouvait pas dire, le chiffre de contrôle le dit : il est calculé
sur les sept premiers chiffres avec les poids 3, 9, 7, 1, 3, 9, 7, complément de la somme
modulo 10 (`src/lib/pl-settlement-number.ts`). L'ordonnance qui le définit (Zarządzenie
nr 7/2017 Prezesa NBP w sprawie sposobu numeracji banków i rachunków bankowych, texte
consolidé du 30/08/2019, modifié le 03/12/2025) n'est lisible ni sur nbp.pl (mur anti-robot)
ni dans la base juridique qui la sert (payante) : l'algorithme est épinglé par les numéros
publiés qu'il reproduit (10100000 NBP, 10201026 PKO BP, 10901014 Santander/Erste, 11402004
mBank), dans le test du module. Servi comme bloc `check_digit` à côté du verdict, jamais comme
`not_allocated` : une impossibilité structurelle et le silence d'un registre sont deux réponses
différentes.

**Groenland — Grønlandsbanken, c'est 6471, et 1601 n'existait nulle part.** Trois citations
convergentes mais périmées (PDF Finanstilsynet 2008, 2009, 2011) donnaient 6471 ; « 1601 »
n'avait aucune source primaire et figurait pourtant dans notre carte curatée
(`GL:1601 → GRENGLGXXXX`, commit e6a99891), servi comme `verified`. Tranché par deux sources
actuelles et indépendantes : le registre des banques de la Finanstilsynet (Bilag 5.1,
`cdn.finanstilsynet.dk/finanstilsynet/media/44631/Bilag5_1PI.pdf`, Grønlandsbanken A/S sous
le reg.nr. 6471) et le compte que publie une institution publique groenlandaise (Grønlands
Nationalmuseum & Arkiv, `da.nka.gl/arkivet/serviceydelser/` : « Grønlandsbanken, kontonummer
6471-100-155-5 ») ; l'exemple officiel du registre IBAN pour GL (`GL89 6471 0001 0002 06`)
porte le même numéro, et GLEIF connaît GRENGLGX comme Grønlandsbanken, Nuuk. Fait :
`GL:6471 → GRENGLGXXXX` ajouté, `GL:1601` retiré. `GL:6460 → FIFBFOTXXXX` (BankNordik,
même numéro que son entrée FO) est laissé tel quel : le numéro est celui de la banque, pas
d'un pays, et rien ne le contredit.

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


---

## BCE + Banco de España — l'identité officielle (`official_identity`)

**Statut : ✅ licences lues à la source le 26/08/2026, ingestion faite le même
jour.** Les deux publient quotidiennement ; les deux imposent la même condition
inhabituelle, et c'est elle qui a dicté la forme du bloc servi.

### Ce qui a été lu, mot pour mot

**BCE** — https://www.ecb.europa.eu/services/disclaimer/html/index.en.html :

> « When such information is distributed or reproduced, it must appear
> accurately and the ECB must be cited as the source. »

> « Where the information is incorporated in documents that are sold (regardless
> of the medium), the natural or legal person publishing the information must
> inform buyers, both before they pay any subscription or fee **and each time
> they access** the information taken from this website, that the information
> **may be obtained free of charge** through this website. »

🚨 **L'octroi commence par « Subject to the exception below »** — clause lue
jusqu'au bout le 26/08/2026, parce qu'une licence dont on ne lit que les
conditions et pas l'exception n'est pas une licence lue. L'exception ne nous
concerne pas :

> « **As an exception to the above**, any reproduction, publication or reprint,
> in whole or in part, of **documents that bear the name of their authors**, such
> as ECB Working Papers and ECB Occasional Papers, in the form of a different
> publication (whether printed or produced electronically) is permitted only
> with the explicit prior written authorisation of the ECB or the authors. »

Elle vise les **publications signées** (Working Papers, Occasional Papers). La
liste quotidienne des IFM est un jeu de données statistique sans auteur : elle
tombe dans l'octroi libre, sous les quatre conditions ci-dessus.

**Banco de España** — https://www.bde.es/wbe/en/pie/aviso-legal/ :

> « Any distribution or reproduction of information disseminated on the Banco de
> España website shall be carried out **faithfully, without any manipulation or
> alteration of the content**, and the Banco de España shall always be cited as
> the source. »

> « When such information is incorporated into documents or other media that are
> to be sold or transferred for consideration, the individual or legal entity
> publishing or disseminating the information by whatever means, shall inform
> buyers and/or transferees that the information **may be obtained free of
> charge** from the Banco de España website, both before they pay any
> subscription or fee **and on each occasion** that the information taken from
> the Banco de España website is made available to them. »

> « The Banco de España shall not be liable for any loss or damage resulting
> from decisions taken on the basis of the information published on this site. »

🚨 **Écart assumé par rapport au cadrage initial du chantier**, qui réservait la
mention « gratuit à la source » à la BCE : le Banco de España impose exactement
le même devoir, dans les mêmes termes, dès que la donnée est vendue. L'API est
vendue. Les **deux** blocs portent donc la mention, chacun pointant vers son
propre site.

### Ce que ça impose au code

- La mention ne peut pas vivre sur une page de documentation : « à chaque
  accès » veut dire **dans chaque bloc de chaque réponse**. `source`,
  `free_of_charge` et `as_of` sont donc des champs **non optionnels** de
  `OfficialIdentity`, et `src/lib/official-identity.ts` en est le seul
  constructeur.
- Un test sérialise chaque bloc possible et échoue s'il manque la phrase, la
  source ou la date (`src/lib/official-identity.test.ts`). Il porte sur la
  **phrase**, pas sur le nom du champ : un renommage qui perdrait la mention ne
  peut pas le passer.
- `authoritative` est typé **littéral `false`** : `authoritative: true` est une
  erreur de compilation, pas une remarque de revue. Les deux publient en
  **relais** — l'attribution des codes reste aux autorités nationales — et le
  Banco de España décline toute valeur probatoire.
- Le bloc est **purement informationnel et additif** : il ne touche ni `valid`
  ni `bank_code_check`. Un test le verrouille explicitement. Faire passer l'une
  de ces deux sources par `NATIONAL_REGISTERS` (dans `src/lib/enrich.ts`) aurait
  posé `authoritative: true` et transformé une absence en `not_in_register` —
  une affirmation qu'aucun des deux ne soutient.

### Ingestion

- `scripts/seed-ecb-mfi.ts` (`npm run db:seed-mfi`) alimente les deux tables et,
  comme le seeder PRA, **abandonne sans rien casser** (log + sortie 0, table
  intacte) sur échec de téléchargement, de parse ou de plancher de cohérence.
- **BCE** : `mfi_csv_YYMMDD.csv`, **UTF-16LE avec BOM, séparateur tabulation**,
  CRLF — malgré l'extension `.csv`. Lu en UTF-8 le fichier se découpe quand même
  en champs : la panne est silencieuse, d'où le contrôle d'en-tête sur les 14
  colonnes attendues. Publié **les jours ouvrés seulement** ; le seeder remonte
  jusqu'à 4 jours. Un fichier absent répond **404 avec ~97 Ko de page d'erreur
  HTML**, donc le test est `response.ok`, jamais la taille.
- **`list_date` ne vient jamais de l'horloge.** Côté BCE c'est la date du nom du
  fichier qui a répondu 200 ; côté Banco de España c'est l'en-tête HTTP
  `Last-Modified` (le fichier n'est daté ni dedans ni dans son URL) — et **si
  cet en-tête manque, l'ingestion est abandonnée** plutôt que datée du jour.
- **Banco de España** : CSV virgule, UTF-8 BOM, chaque champ **rembourré de
  centaines d'espaces** (export à largeur fixe déguisé en CSV). Un code non
  trimé ne joint rien, silencieusement et pour toujours.

### La jointure, et ce qui a été refusé

- **Par LEI** (`/v1/bic/:code`) : sans portée pays, **contrairement à
  `pra_authorisation`**. Ce bloc dit **qui est** le titulaire du LEI, pas ce
  qu'il a le droit de faire quelque part ; une identité légale ne change pas
  selon le BIC par lequel on est entré. Le fan-out est réel et va dans l'autre
  sens : mesuré le 26/08/2026, 232 des LEI de la liste portent **plusieurs
  BIC8** (un seul en couvre 42, dans autant de pays), donc une ligne répond
  légitimement à beaucoup de lookups. Aucune ambiguïté inverse : le fichier ne
  contient **aucun LEI en double**.
- **FR** : le code RIAD est `FR` + le **code banque à 5 chiffres** (`FR30004` =
  BNP Paribas — vérifié aussi sur Société Générale, LCL, La Banque Postale). La
  colonne `national_bank_code` n'est remplie **que** pour les lignes FR.
- 🚨 **La forme ne suffit pas, le pays est obligatoire.** Sur le fichier réel,
  1 240 lignes allemandes et 569 polonaises ont la **même forme** `XX` +
  5 chiffres — et `DE07802` est une Bausparkasse dont le BLZ est 60430000, pas
  07802. Servir le nom d'un établissement allemand derrière un IBAN français,
  sur un appel payant, est exactement ce que ce garde-fou empêche.
- **ES** : la colonne `SUPERVISORY CODE` du Banco de España publie le **code
  banque à 4 chiffres nu** (0182 = BBVA). Quatre lignes publient des codes du
  type `FI2680` — des fonds monétaires, pas des banques : filtrées par
  `/^\d{4}$/`. Corroboration utile : 227 des codes RIAD espagnols de la BCE
  coïncident avec ceux du Banco de España, mais c'est bien le Banco de España
  qui publie l'espace de codes et dont la formule d'attribution est reproduite.
- ❌ **Portugal non implémenté** : l'heuristique de mapping qui circule n'est
  documentée nulle part par la BCE. Une règle non documentée n'a pas sa place
  derrière une réponse payante.
- 🚨 Deux lignes portent `E$` en pays (la BCE elle-même et la BEI) : ce n'est
  pas un code ISO. Stocké tel quel, aucune contrainte `CHECK` sur la colonne, et
  aucun chemin par code national ne peut l'atteindre.

### Attribution servie

Le crédit vit **dans la base**, jamais en dur : `getEcbMfiCount()`,
`getBdeMfiCount()`, `getEcbListDate()` et `getBdeListDate()` alimentent
`/llms.txt`. La formule espagnole est reproduite mot pour mot :

> Own elaboration based on data from the Banco de España website (www.bde.es)


## NBS — le prevodník slovaque (`national_bank_codes`, pays SK)

Ingéré le **06/09/2026**. Page officielle, stable :
<https://nbs.sk/en/payments/general-information/directories-and-registers/directory-identification-codes-domestic-payment-system-in-sr/>

### Ce qui a été lu, mot pour mot

Conditions d'utilisation du site, titre « Podmienky používania », lues à la
source le **06/09/2026** :

> « Informácie zverejňované na internetovej stránke NBS je povolené ukladať,
> rozmnožovať a ďalej používať* bez predchádzajúceho súhlasu Národnej banky
> Slovenska. Národná banka Slovenska však musí byť uvedená ako zdroj týchto
> informácií a príslušný elektronický súbor nesmie byť obsahovo ani inak
> pozmeňovaný. »
> — <https://nbs.sk/disclaimer-sk/>

Traduction de travail : les informations publiées sur le site de la NBS peuvent
être stockées, reproduites et réutilisées sans accord préalable de la Národná
banka Slovenska. La NBS doit toutefois être citée comme source de ces
informations et le fichier électronique concerné ne doit être modifié ni dans
son contenu ni autrement.

L'astérisque renvoie à une note de bas de page qui ne concerne **que** la
reproduction des billets en euros (décision BCE/2003/4) : sans rapport avec un
répertoire de codes de paiement.

### La position et la réponse reçue

**Position retenue par Claude-Alain le 24/09/2026 : le registre slovaque est
publiable, avec la citation.** L'API sert **un enregistrement par requête**, noms
verbatim, avec le crédit « Zdroj: Národná banka Slovenska », la version et la
date d'effet lues sur la page. Les lignes extraites figurent aussi dans le dépôt
public (`data/bic.sqlite`, `frontend/data/registers/sk-bank.json`), avec la même
citation dans `NOTICE` (groupe A). Le fichier électronique de la NBS lui-même
n'est ni republié ni modifié.

**Réponse de la NBS du 09/09/2026, relue le 14/09/2026**, à la demande du
26/08 sur l'extraction de champs dans une API commerciale : la NBS indique
que le répertoire est disponible pour réutilisation, notamment pour traitement,
et demande de citer **Národná banka Slovenska** comme source. Elle fournit
le fichier <https://nbs.sk/dokument/53533909-a9c9-4727-8b89-c9fca5e214ca/stiahnut/?force=true>.
La mention « sans réponse » est donc périmée. Cette clarification porte sur
l'usage décrit ; conserver l'attribution, les noms verbatim et la traçabilité
de l'édition. Elle ne remplace pas les conditions générales par une licence
ouverte sans restrictions ni ne fige l'UUID du fichier pour les rafraîchissements.

### Ce que ça impose au code

- `source` et `as_of` sont des **colonnes** de `national_bank_codes`, lues par
  toutes les surfaces (`nationalRegisterEdition()` / `nationalRegisterCredit()`
  dans `src/lib/national-registers.ts`). Un crédit écrit en dur pourrit au
  premier rafraîchissement — et ici il rompt une condition de licence.
- Les noms sont stockés **verbatim**, `trim()` des bords seulement : ni
  translittération, ni nettoyage des espaces insécables internes.
- AT et BE laissent ces deux colonnes à `NULL` et gardent `getReferenceAsOf()` :
  leurs éditeurs ne demandent aucun crédit et ne publient aucune date d'édition.

### Base normative : cherchée, pas trouvée

Ni la page du répertoire ni le PDF qu'elle publie ne citent d'acte normatif
(`Opatrenie` absent des deux, vérifié le 06/09/2026). La revendication
d'autorité repose donc sur ce que la page **est** : la NBS publie le répertoire
complet des codes qu'elle attribue aux prestataires du système de paiement
domestique, en éditions numérotées et datées. **Aucun texte n'est cité ici
faute d'avoir pu le vérifier** — un article de loi inventé dans un commentaire
de licence serait pire que l'absence honnête.

### Le piège du lien direct

`https://www.nbs.sk/_img/documents/_platobnesystemy/eurosips/prevodnik_ik_tps_sr.csv`
répond encore **HTTP 200** et sert une édition **périmée** (en-tête slovaque,
42 lignes, trois banques parties — 5200, 8050, 8170 — et aucune des trois
arrivées — 2250, 3030, 6363). Mesuré le 06/09/2026. Le seeder part de la page
et suit l'ancre qui finit par « (CSV) », dont l'UUID change à chaque version.


## ČNB — le číselník tchèque (`national_bank_codes`, pays CZ)

Ingéré le **25/09/2026** (édition 254, en vigueur depuis le 01/09/2026). Page
officielle : <https://www.cnb.cz/cs/platebni-styk/ucty-kody-bank/>. Étude
complète : dossier privé `docs/internal/registres-2026-09-24/`.

### Ce qui a été lu, mot pour mot

Conditions d'utilisation du site, « Podmínky užívání internetových stránek
ČNB », § 3, lues à la source le **24/09/2026** :

> « Naše internetové informace můžete ukládat, předávat dále a rozmnožovat s
> výjimkou autorských textů, t.j. takových textů, v jejichž záhlaví nebo zápatí
> je uveden autor […] a obrázků, z nichž je zřejmé, že práva k obrázkům nevlastní
> ČNB. […] ČNB musí být vždy uvedena jako zdroj informací (Zdroj: ČNB), soubor
> nesmí být obsahově ani jinak pozměňován a musí být otevřen vždy v novém okně
> prohlížeče. Pokud je použit výňatek z textu, rozdělení na více textů nebo
> spojení více textů, nesmí dojít ke změně faktů a smyslu textu. »
> — <https://www.cnb.cz/cs/ochrana-osobnich-udaju-a-pravni-ujednani/podminky-uzivani-internetovych-stranek-cnb/>

Traduction de travail : on peut stocker, transmettre et reproduire les
informations du site, sauf textes signés et images de tiers ; la ČNB doit
toujours être citée (« Zdroj: ČNB ») ; le fichier ne doit être modifié ni dans
son contenu ni autrement, et il doit toujours être ouvert dans une nouvelle
fenêtre du navigateur ; en cas d'extrait, de découpage ou de réunion de textes,
les faits et le sens ne doivent pas changer.

La clause de la nouvelle fenêtre vise l'ouverture d'un fichier de la ČNB dans
un navigateur. IBANforge ne sert ni n'ouvre ce fichier : l'API sert des champs
extraits, un enregistrement par requête, ce que couvre la phrase sur les
extraits (et l'avis du 27/08/2026 cité plus bas). Elle est donc sans objet ici.

Base de l'exhaustivité, vyhláška č. 169/2011 Sb., publiée par la ČNB
(<https://www.cnb.cz/export/sites/cnb/cs/platebni-styk/.galleries/pravni_predpisy/download/vyhl_169_2011.pdf>),
lue le **24/09/2026** et relue le **25/09/2026** sur le PDF publié (texte extrait
par `pdftotext`, coupures de fin de ligne recollées) :

> § 4 : « Číslo účtu ve formátu IBAN je tvořeno 24 alfanumerickými znaky, kdy
> […] c) pátý až osmý znak obsahují číslice kódu platebního styku (§ 6) […] »
>
> § 6 al. 2 : « Česká národní banka uveřejňuje kódy platebního styku, které
> poskytovateli platebních služeb přidělila, v Číselníku kódů platebního styku
> v České republice, a to způsobem umožňujícím dálkový přístup. »

Les positions 5 à 8 de tout IBAN tchèque sont le code de paiement, et la ČNB
publie dans ce číselník les codes qu'elle a attribués : un code absent de
l'édition en vigueur n'est attribué à personne. C'est ce qui range la Tchéquie
dans `NATIONAL_REGISTERS` (`authoritative: true`), comme la Slovaquie.

### La position

- **Commercial** : aucune restriction commerciale dans ces conditions (la seule
  interdiction commerciale de la page vise le logo de la ČNB).
- **Extraction de champs** : prévue par la dernière phrase citée, à condition
  que les faits et le sens restent intacts. L'API sert un enregistrement par
  requête, noms verbatim (diacritiques compris), BIC tel que publié, avec
  l'édition et sa date d'effet.
- **Avis écrit** : réponse du département des paiements de la ČNB du
  27/08/2026 à la demande du 26/08 : l'extraction du code et du BIC, avec la
  source et la date, n'altère pas l'information ; avis personnel du service,
  pas une position juridique de la ČNB. Les conditions du site suffisent sans
  lui.
- **Aucune lettre à écrire.**

### Ce que ça impose au code

- `source` porte la mention exigée **en tête** : « Zdroj: ČNB, Číselník kódů
  platebního styku v ČR, verze N » ; `as_of` porte la date d'effet de
  l'édition. `nationalRegisterCredit('CZ')` en fait « … verze N (platný od
  AAAA-MM-JJ) » pour `/llms.txt`. Le nom du registre servi dans
  `bank_code_check.register` contient lui aussi « Zdroj: ČNB », parce qu'un
  refus et les codes publiés sans BIC n'ont pas de bloc `bic` pour porter la
  mention.
- **Chaque édition paraît avant sa date d'effet** (règles du ČKPS, art. III.3 ;
  le CSV de l'édition 254 est daté du 24/08/2026 pour un effet au 01/09/2026),
  et le CSV ne porte **ni numéro ni date** : le chargeur lit l'édition et la
  date sur la page, garde l'édition en vigueur dans `national_bank_codes` et
  l'édition annoncée dans `national_bank_codes_pending`. La bascule se fait **à
  la requête**, à minuit heure de Prague le jour d'effet
  (`src/lib/national-registers.ts`, `activeTable()`), jamais au jour du
  téléchargement. Toutes les éditions ne partent pas le 1er (251 le
  16/03/2026, 245 le 09/04/2025), alors que le rafraîchissement mensuel tourne
  le 1er.
- L'édition en vigueur se lit dans son CSV **numéroté**
  (`kody_bank_CR_<N>.csv`). La page lie ce fichier numéroté pour une édition
  annoncée (copie archivée du 28/08/2026 : 254 lié par `kody_bank_CR_254.csv`,
  253 par le fichier non numéroté). Quand rien n'est annoncé, le numéroté est
  comparé au CSV lié par la page ; s'ils diffèrent, ou si le lié ne se lit pas,
  le numéroté est chargé, aucune annonce n'est écrite et un avertissement est
  journalisé ; le rafraîchissement suivant relit la page.
- Une annonce lue dans son fichier **numéroté** est écrite même si ses codes,
  noms et BIC sont ceux de l'édition en vigueur (des éditions ne changent que
  la colonne CERTIS, non stockée : 235→236, 248→249, 250→251). Seule une
  annonce lue dans le fichier non numéroté, identique à l'édition en vigueur,
  est écartée : ce fichier ne porte pas de numéro et n'a peut-être pas encore
  bougé.
- Une source **injoignable** (réseau, erreur HTTP, connexion coupée pendant le
  transfert, délai dépassé), une **page de refus servie en HTTP 200** (page sans
  le nom « Česká národní banka », ou HTML à la place d'un CSV), des dates
  **contradictoires** entre la page et l'historique, ou une édition **plus
  ancienne** que celle déjà servie laissent les deux tables telles quelles et
  ne font pas échouer le rafraîchissement mensuel (on ne sait pas si cnb.cz
  répond aux machines de GitHub). Un changement de **format** (page de la ČNB
  sans la phrase « Číselník N platný od … », CSV sans son en-tête, édition sous
  le plancher) le fait échouer.
- **Pas de silence** : une source non chargée écrit une annotation `::warning::`
  et la sortie d'étape `cz_register=not_loaded`. Une étape finale « Czech
  register not loaded (cnb.cz) » la change en run rouge, ce qui envoie l'alerte
  Telegram existante. Dans le rafraîchissement mensuel, cette étape vient APRÈS
  le commit et le battement : les autres sources sont déjà poussées.
- **Relecture quotidienne** : `.github/workflows/refresh-cz-register.yml`, chaque
  jour à 05:17 UTC, lance le chargeur tchèque SEUL (`seed-national.ts CZ`, rien
  d'autre n'est téléchargé). Il ne commite que si le CONTENU des lignes CZ a
  changé (`scripts/cz-register-diff.ts` compare la base à celle de HEAD, table
  par table, et refuse le commit si une autre table, un autre pays ou le schéma
  diffère), après le même garde de qualité (`refresh-diff.ts`) et les tests ;
  même alerte Telegram. Groupe de concurrence `bic-sqlite-writer`, partagé avec
  `refresh-bic.yml` : les deux ne s'écrasent jamais. Raison : une édition qui
  entre en vigueur hors du 1er (251 le 16/03/2026) ferait sinon refuser, avec
  autorité, les codes qu'elle crée jusqu'au mois suivant.

### Les pièges de la source

- Le serveur envoie le CSV avec `Content-Type: text/html;charset=UTF-8` : rien
  ne filtre sur le type, c'est la ligne d'en-tête qui prouve le fichier.
- La page porte un bloc commenté qui pointe vers `admin-cnb.cz.net`, serveur
  d'administration de la ČNB : les commentaires HTML sont retirés avant toute
  lecture.
- Certaines éditions ouvrent sur une marque d'ordre d'octets (253 oui, 254 non).
- Onze codes de l'édition 254 n'ont pas de BIC (caisses d'épargne-logement,
  coopérative, Banking Circle, Multitude Bank…) : ce sont des attributions
  réelles, gardées avec un BIC nul.
- L'historique des changements (PDF, depuis 2009) donne les successeurs en
  texte libre seulement : aucun `superseded_by` n'est servi pour la Tchéquie.

## Banca d'Italia : les registres italiens (`national_bank_codes` et `national_bank_codes_retired`, pays IT)

Ingérés le **25/09/2026** (édition du 23/09/2026). Deux jeux de l'open data de la
Banca d'Italia (base GIAVA), repris sur le portail AgID dati.gov.it : « Lista
intermediari » (`VFLUSSO_INTERMEDIARIO`, l'élenco **historique** des
intermédiaires, mis à jour chaque jour) et « Lista fusioni, incorporazioni,
cessioni attività e passività ecc. » (`VFLUSSO_EVENTO`, chaque semaine). Page de
téléchargement : <https://infostat.bancaditalia.it/GIAVAInquiry-public/ng/#/area-download>.
Catalogue DCAT de la Banca d'Italia, qui déclare la licence jeu par jeu :
<https://www.bancaditalia.it/footer/open-data/Open_Data_BdI.rdf>. Étude complète :
dossier privé `docs/internal/registres-2026-09-24/`.

### 🚨 Un registre partiel : une absence ne prouve rien

Les registres listent les **banques** (`TIPO_ALBO` 001), les **établissements de
paiement** (012) et de **monnaie électronique** (016, et l'ancien 010 pour
l'historique) que la Banca d'Italia inscrit. Ils ne publient pas l'attribution de
l'espace ABI, et trois émetteurs réels d'IBAN italiens n'y figurent pas : Poste
Italiane (07601), la Banca d'Italia elle-même (01000, Trésor) et les succursales
d'établissements de paiement européens (Qonto, 36092). L'Italie est donc dans
`NON_EXHAUSTIVE_REGISTERS` (`src/lib/enrich.ts`), comme Saint-Marin : un code en
vigueur nomme son titulaire (`verified`, `authoritative: false`), un code absent
garde la réponse de la carte composite, jamais `not_allocated`.

Le filtre se fait par **registre**, jamais par plage de codes : des établissements
de paiement portent des codes 19xxx (AGOS-DUCATO 19309), et les autres registres
(SGR, art. 106, OICR) nomment des sociétés qui n'émettent aucun IBAN.

### Le vrai apport : les codes radiés

Un code que le registre déclare **radié** est un fait positif, pas une absence.
Il répond `verified` avec `retired: true`, `retired_on` (dernier jour où le
registre porte le code pour son dernier titulaire) et, s'il existe,
`superseded_by`, le **successeur légal** en vigueur ; `authoritative` reste
false et le titulaire est `inferred` (personne ne tient ce code aujourd'hui).
Jamais un refus : la durée pendant laquelle un ancien IBAN reste joignable après
une fusion italienne n'est publiée nulle part. Le nom périmé de la carte curée
n'est plus servi (`bic` est null).

Trois règles, tenues par `scripts/seed-national-it.test.ts` :

- l'historique se lit **par date** : un code peut être réattribué (03111 : Banca
  Lombarda de 1998 à 2007, puis UBI Banca de 2008 à 2021) ou réinscrit (03268,
  Banca Sella, radiée fin 2005 et réinscrite le lendemain). Un code qui a un
  titulaire en vigueur est en vigueur ; sinon c'est son dernier titulaire qui
  fait foi ;
- le successeur se suit **par entité** (`ID_INT`), jamais par code, à travers
  les seules fusions (002) et incorporations (003), jusqu'à la première entité en
  vigueur. Une entité qui a changé de code (BNP Paribas SA, 03181 puis 03479) a
  pour successeur son nouveau code. Les **cessions** d'actifs et de guichets ne
  font pas de successeur légal : la Banca Popolare di Vicenza (05728, liquidée en
  2017, actifs cédés à Intesa Sanpaolo) n'en a pas ;
- ce successeur est **légal**, rien de plus : avant son absorption par Intesa
  Sanpaolo, UBI avait cédé des guichets à BPER, dont les comptes sont partis chez
  BPER. Le texte de `next_steps` le dit.

Mesuré sur l'édition du 23/09/2026 : 464 codes en vigueur (414 banques, 39
établissements de paiement, 11 de monnaie électronique), 1 907 codes radiés,
dont 1 130 avec un successeur légal en vigueur. Aucune entité n'est le passif de
deux fusions ou incorporations ; une seule incorporation prend effet loin de la
radiation (IW Bank, sortie du registre des banques en 2022 et incorporée comme
SIM en 2024 par Fideuram), et elle reste son successeur légal.

### Ce qui a été lu, mot pour mot

Conditions du site de la Banca d'Italia, lues le **24/09/2026** et relues le
**25/09/2026** sur <https://www.bancaditalia.it/footer/copyright/index.html> :

> « La stampa e il salvataggio (su disco o su altri supporti di memorizzazione)
> dei contenuti di questo sito sono consentiti per solo uso personale, con
> esclusione di ogni utilizzo per fini di lucro o per trarne qualsivoglia utilità
> economica. […] Fanno eccezione gli open data della Banca d'Italia, inclusi nel
> portale AgID raggiungibile al link https://dati.gov.it , i quali sono rilasciati
> con licenza Creative Commons Attribuzione 4.0 Internazionale (CC-BY 4.0). Tale
> licenza ne consente il riutilizzo, anche per fini commerciali, a condizione di
> citarne la fonte indicando eventuali modifiche apportate. »

Les deux jeux sont publiés sur dati.gov.it par l'organisation Banca d'Italia
sous « Creative Commons Attribuzione 4.0 Internazionale (CC BY 4.0) » (API CKAN,
24/09/2026), et le catalogue DCAT de la Banca d'Italia déclare la même licence
pour chaque distribution (`<dct:license rdf:resource="https://creativecommons.org/licenses/by/4.0/"/>`,
relu le 25/09/2026).

Licence CC BY 4.0, section 3(a)(1), lue le 24/09/2026 sur
<https://creativecommons.org/licenses/by/4.0/legalcode.en> : « identification of
the creator(s) […]; a copyright notice; […] a URI or hyperlink to the Licensed
Material to the extent reasonably practicable; indicate if You modified the
Licensed Material […]; and indicate the Licensed Material is licensed under this
Public License, and include the text of, or the URI or hyperlink to, this Public
License. » Le jeu ne porte aucune mention de droit d'auteur à reproduire.

Attention : le même institut publie d'autres documents hors du portail AgID (un
ancien `Elenco_banche.pdf`, par exemple), qui restent sous l'interdiction
générale. Seuls les jeux de dati.gov.it sont couverts.

### La position

- **Commercial** : oui, expressément.
- **Permission écrite** : pas nécessaire. **Aucune lettre à écrire.**
- **Mention** : l'auteur, le jeu, la licence et son URI, l'édition, et
  l'indication des modifications (« normalised and joined by IBANforge » : codes
  ramenés à cinq chiffres, codes en vigueur choisis, codes radiés datés et reliés
  à leur successeur par la liste des fusions).

### Ce que ça impose au code

- `source` porte l'auteur, le jeu et la licence : « Banca d'Italia, Albi ed elenchi
  di vigilanza (open data, CC BY 4.0, https://creativecommons.org/licenses/by/4.0/) » ;
  `as_of` porte l'édition, lue dans le **nom du fichier** du ZIP
  (`2026-09-23_INTERMEDIARI.csv`), jamais dans `dct:modified` du catalogue, qui
  date les métadonnées. `nationalRegisterCredit('IT')` en fait « Source: …,
  edition AAAA-MM-JJ; normalised and joined by IBANforge » pour `/llms.txt`.
- Le nom servi dans `bank_code_check.register` porte lui aussi l'auteur, le jeu,
  la licence et la modification : sur un code radié, aucun bloc `bic` ne porte le
  crédit à sa place. Même choix que « Zdroj: ČNB » dans le nom tchèque.
- Le registre ne publie **aucun BIC** : pour un code en vigueur, le BIC servi
  reste celui de la carte composite (`basis: curated_map`), jamais inventé.
- Adresse servie : le siège légal **en Italie** (pour une banque étrangère, sa
  succursale italienne, l'entité titulaire du code) ; le LEI quand la Banca
  d'Italia le publie. Sur un code radié, le nom du dernier titulaire seulement.
- **Relecture hebdomadaire** : `.github/workflows/refresh-it-register.yml`, chaque
  jeudi à 05:37 UTC (le fichier des événements est hebdomadaire, celui des
  intermédiaires quotidien ; mesuré de juin à septembre 2026, le contenu utile
  change quelques fois par mois). Le chargeur italien tourne SEUL
  (`seed-national.ts IT`, jamais dans la passe mensuelle, qui ne dépend donc pas
  de bancaditalia.it). Il ne commite que si le CONTENU des lignes IT a changé
  (`scripts/it-register-diff.ts` refuse le commit si une autre table, un autre
  pays ou le schéma diffère), après le garde de qualité et les tests, et réexporte
  alors les pages `/it` (`pages:export -- IT`). Groupe de concurrence
  `bic-sqlite-writer`, partagé avec les deux autres écrivains de la base.
- Une source **injoignable**, une **page** servie à la place du ZIP (le serveur
  d'authentification répond une page HTML de 1 Ko sans pot à cookies) ou une
  édition **plus ancienne** que celle déjà servie laissent les deux tables telles
  quelles, écrivent `::warning::` et la sortie `it_register=not_loaded`, que la
  dernière étape change en run rouge et en alerte Telegram. Un changement de
  **format** (colonne manquante, nombre de champs qui bouge, archive sans le
  fichier attendu, édition sous les planchers) fait échouer le run.

### Les pièges de la source

- **Poignée de main à cookies** : l'adresse de téléchargement répond 302 vers
  `auth.bancaditalia.it/oam/…`, qui renvoie vers `infostat…/obrar.cgi`, qui renvoie
  vers le fichier ; les cookies posés en chemin sont exigés au dernier saut. Le
  chargeur suit les redirections à la main, un pot par téléchargement.
- ZIP d'un seul CSV UTF-8 avec BOM, séparateur `;`, champs rembourrés d'une espace,
  en-tête qui commence par « ID_INT » précédé d'une espace. Des **guillemets
  littéraux** (« C.D. "ALBO UNICO" ») ne sont pas des délimiteurs : un analyseur CSV
  classique les mangerait. Le commentaire de l'archive annonce une longueur plus
  grande que celle qu'il a (`unzip` : « zipfile comment truncated »).
- `COD_MECC` s'écrit sans zéro de tête (`3111` pour 03111) ; plusieurs milliers de
  lignes anciennes n'ont pas de code du tout.
- **Sans le filtre des périodes ouvertes** (`DATA_F_VAL = 9999-12-31`), on sert des
  noms périmés.
- Un code radié de la liste des banques peut rester vivant dans un autre registre
  (une banque devenue SIM ou intermédiaire art. 106) : le chargeur ne regarde que
  les quatre registres des IBAN, et le code est bien radié de ceux-là.

## BCSM — les banques opérationnelles de Saint-Marin (`national_bank_codes`, pays SM)

Ingérée le **06/09/2026**. Page :
<https://www.bcsm.sm/en/functions/statutory-functions/payment-system/operating-banks>

### 🚨 Le point le plus important : ce registre n'est PAS exhaustif

C'est le premier registre ingéré dont une **absence ne prouve rien**, et tout le
reste en découle. La page s'intitule « Operating Banks » : elle liste les quatre
banques que la BCSM supervise, elle ne publie **pas** l'attribution de l'espace
des codes ABI. Trois faits, tous vérifiables :

- Saint-Marin agrée aussi des prestataires de services de paiement et de monnaie
  électronique qui **ne sont pas des banques** ; au moins un détient un BIC
  saint-marinais et participe à EBA STEP2, et il n'est pas sur cette page.
- L'IBAN d'exemple officiel du registre ISO 13616, `SM86U0322509800000000270100`,
  porte le code ABI `03225` — **absent de la page**.
- Rien sur bcsm.sm ne prétend que cette liste épuise l'espace des codes.

Conséquences dans le code, à ne pas « ranger » plus tard :

- **SM n'est PAS dans `NATIONAL_REGISTERS`** (`src/lib/enrich.ts`). Le docstring
  de cette table le dit lui-même : « Adding a country here is a claim that a miss
  means non-existence. » Un premier jet l'y avait mis, et le défaut n'était pas
  seulement le `not_allocated` attendu : la retombée composite lit
  `const registerDown = !!national`, donc chaque absence saint-marinaise aurait
  répondu `national_register_unavailable` — « registre inconsultable » — à propos
  d'un registre consulté qui avait répondu. Le mensonge change de cible, pas de
  nature.
- SM vit dans `NON_EXHAUSTIVE_REGISTERS`, sur un chemin séparé : un résultat est
  `verified` avec le bloc `institution`, une absence **retombe** telle quelle.
- SM n'est **pas** dans `pruneStaleNationalCodes` (`src/lib/bic-lookup.ts`).
- `nationalRegisterIsExhaustive()` porte la distinction, plutôt qu'une liste de
  pays recopiée à chaque endroit.

### La licence : aucune, et c'est consigné comme tel

Vérifié le **06/09/2026** : bcsm.sm ne publie **aucune condition d'utilisation**.
Il y a une politique de confidentialité et un « © Central Bank of the Republic of
San Marino » en pied de page, rien d'autre — ni autorisation, ni interdiction.

**Aucune clause n'est inventée.** La licence est enregistrée `unknown`. Position
retenue : quatre lignes de données de routage (nom, adresse, ABI, BIC) publiées
par l'autorité de surveillance pour être utilisées, servies **un enregistrement
par requête**, avec le crédit
« Source: Central Bank of the Republic of San Marino, operating banks (read on
<date>) » donné **par choix et non par obligation**.

⏳ **Lettre de confirmation à la BCSM à écrire** (prochain lot de courrier). En
cas de refus, le registre est retiré.

### La date : la nôtre, et le crédit le dit

La page ne porte **ni numéro d'édition ni date de révision**. `as_of` est donc le
**jour de lecture**, et `nationalRegisterCredit('SM')` l'écrit « read on … »
plutôt qu'entre parenthèses nues : une date nue s'y lirait comme celle de la BCSM
et la surestimerait. Corollaire assumé : chaque exécution du seeder réécrit les
quatre lignes avec une date neuve, donc `data/bic.sqlite` et `sm-bank.json`
bougent à chaque rafraîchissement même si la page n'a pas changé.

### Deux pièges du HTML, tenus par la fixture de test

- 🚨 **Le nom de la première banque est coupé en deux `<strong>` sans espace**
  (`<strong>Banca</strong><strong>Agricola Commerciale …</strong>`). Un
  déballage naïf des balises — et un navigateur — rendent « BancaAgricola ». Ce
  n'est pas le nom de l'établissement : notre propre ligne GLEIF pour BASMSMSM
  porte « BANCA AGRICOLA COMMERCIALE ISTITUTO BANCARIO SAMMARINESE ». Les
  balises sont donc remplacées par une **espace**, ce qui est lire à travers une
  frontière d'élément, pas modifier la donnée.
- Le quatrième bloc écrit « Telephone/Fax: » là où les trois autres écrivent
  « Phone/Fax: », et le libellé d'ouverture alterne entre « Corporate name: » et
  « Company name: ». Seuls « ABI Code: » et « SWIFT BIC: » servent d'ancres.

### Ce que ça a apporté, mesuré

Avant ingestion (06/09/2026), **tout** IBAN saint-marinais répondait `bic: null`,
y compris pour les quatre vraies banques : les onze clés `SM:` de la carte curée
sont des radicaux de BIC à quatre lettres (`SM:BASM`, `SM:MAOI`…) alors qu'un
IBAN saint-marinais porte **cinq chiffres**. Elles ne pouvaient jamais
correspondre. Gain net, rien à élaguer.


## ABBL — registre luxembourgeois IBAN/BIC (import privé)

Source officielle : <https://www.abbl.lu/professionals/payments/luxembourg-register-of-iban-bic-codes/>.
La page de publication <https://www.abbl.lu/publications/abbl-luxembourg-register-of-iban-bic-codes/>
lie le classeur courant. Le lien est résolu à chaque import ; sa partie variable ne doit pas être figée.

Une confirmation écrite du 15/09/2026 autorise l'utilisation décrite : une entrée normalisée
par réponse API, y compris commerciale, avec « Source: ABBL, Luxembourg register of IBAN/BIC codes »
et date de publication, actualisation mensuelle et sans redistribution du fichier source.
La preuve complète reste dans le dossier interne privé. Cela ne crée pas une licence générale
pour redistribuer le registre dans le dépôt, les exports ou les paquets.

### Stockage et raccordement

`scripts/seed-lu-register.ts` produit un fichier JSON privé, jamais `data/bic.sqlite`.
`LU_REGISTER_PATH` désigne explicitement ce fichier. Aucun téléchargement au traitement d'une
requête, aucune clé API ni donnée client dans cet import. Le fichier est écrit en mode 600
par remplacement atomique, après contrôle des en-têtes, codes, BIC luxembourgeois, doublons,
date et taille minimale. Un recul de date ou une baisse de plus de 10 % demande une vérification
manuelle et laisse l'édition précédente intacte. Un fichier local invalide bloque aussi son
remplacement automatique : l'opérateur doit examiner la situation.

La date est celle de publication visible sur la page, pas la date de téléchargement ni
le `dateModified` technique du site. La mention « published » l'explicite dans le crédit servi.
Chaque correspondance porte la source et la date dans `bic` et `bank_code_check`.
Le BIC provient directement du couple publié par l'ABBL. Le contrôle d'allocation garde
`authoritative: false` : une absence ne devient pas `not_allocated`. Aucun total de couverture
ni page de liste n'est ajouté avant activation et vérification en production.

L'import et le lecteur sont prêts pour l'intégrateur ; ni le stockage de production ni la
chaîne de déploiement ne sont modifiés ici. L'import doit être exécuté mensuellement dans le
circuit privé autorisé. Il n'est pas ajouté au workflow public qui régénère et commite les bases.
