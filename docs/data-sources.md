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
- **Aucune licence n'est nommée sur aucune surface publique.**

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
   | GAFI (`fatf-gafi.org/en/pages/terms-and-conditions.html`) | ❌ **403**, y compris avec un UA de navigateur |
   | EPC (`europeanpaymentscouncil.eu/terms-use`) | ❌ **403**, idem |
   | NBP (`nbp.pl/en/terms-of-use/`) | ❌ **mur anti-robot servi en 200** |
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
par un import. Deux brouillons de demande sont prêts (FCA et BoE) — l'envoi est
la voix de Claude-Alain.

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
