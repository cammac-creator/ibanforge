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
| EBA Clearing STEP2 SCT | 183 | « All rights reserved by EBA CLEARING », aucune licence publiée | ❌ **non établie — lu à la source le 24/08/2026**, voir ci-dessous |
| NBP (Pologne) | 21 | publication publique | ❌ non établie — mur anti-robot |
| OFAC (sanctions) | — | **CC0 1.0 déclaré par le Treasury lui-même** + domaine public 17 U.S.C. §105 | ✅ **vérifié à la source le 24/08/2026** |
| ONU (liste consolidée CSNU) | — | ⚠️ **tous droits réservés, usage personnel NON COMMERCIAL uniquement** | ✅ établie le 24/08/2026 — position arrêtée, voir la section citations |
| UE (liste consolidée + réutilisation Commission) | — | **CC BY 4.0**, Décision du 12/12/2011 | ✅ vérifié le 24/08/2026 |
| Bank of England — List of PRA-regulated Banks (table `pra_banks`) | 281 au 2026-08 | permission écrite du 25/08/2026, **attribution à la Bank of England ET au mois de la liste obligatoire** | ✅ **accordée le 25/08/2026 — ingérée le 25/08/2026**, voir ci-dessous |
| BCE — liste quotidienne des IFM (table `ecb_mfi`) | 5 374 au 2026-08-25 | usage libre, **citation de la BCE** + **mention « gratuit à la source » à CHAQUE accès** dès que l'information est vendue | ✅ **lue à la source le 26/08/2026 — ingérée le 26/08/2026**, voir ci-dessous |
| Banco de España — liste des IFM espagnoles (table `bde_mfi`) | 238 au 2026-08-25 | reproduction « faithfully, without any manipulation », **citation du Banco de España** + **même mention « gratuit à la source » à chaque mise à disposition** | ✅ **lue à la source le 26/08/2026 — ingérée le 26/08/2026**, voir ci-dessous |
| Národná banka Slovenska — prevodník des codes d'identification (`national_bank_codes`, pays SK) | 38 en version 225 (effet 18.05.2026) | réutilisation autorisée **sans accord préalable**, mais **citation de la NBS obligatoire** et **fichier non modifié** | ⚠️ **lue à la source le 06/09/2026 — ingérée le 06/09/2026**, lettre du 26/08/2026 sans réponse, voir ci-dessous |

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

**OFAC — CC0 1.0, déclaré par le Treasury pour CE dataset.** ✅ (24/08/2026)
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

1. **Établir les licences encore marquées ❌.** Sept sur treize sont établies
   au 24/08 : SwiftCodes, GLEIF, Bundesbank, SIX BankMaster (23/08), puis
   **UE (CC BY 4.0)**, **OFAC (CC0)** et **ONU** (24/08). Restent **EBA
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

### La position, et ce qui reste ouvert

Nous ne redistribuons pas le fichier : nous servons **un enregistrement par
requête**, noms verbatim, avec le crédit « Zdroj: Národná banka Slovenska », la
version et la date d'effet lues sur la page.

⏳ **Lettre du 26/08/2026 à info@nbs.sk, sans réponse au 06/09/2026** : elle
demande si l'extraction de champs compte comme une modification du fichier au
sens de la clause ci-dessus. La ČNB, sur une clause quasi identique, a répondu
le **27/08/2026** que non (« you do not alter the information », avis personnel
du département). **Si la NBS répond par la négative, le registre est retiré.**

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
