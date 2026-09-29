import type { ApiPageCopy } from "./copy";

// Une phrase par ligne là où un chiffre apparaît : les gardes de prose du dépôt
// de l'API lisent ce fichier ligne par ligne et phrase par phrase.
export const COPY_FR: ApiPageCopy = {
  meta: {
    title: "API de validation IBAN : banque, BIC et code bancaire",
    description:
      "API de validation IBAN pour vos logiciels : clé de contrôle, structure par pays, banque et BIC lus dans les registres nationaux avec source et date, SEPA. Essai sans clé.",
    ogLocale: "fr_FR",
  },
  breadcrumbHome: "Accueil",
  hero: {
    eyebrow: "API REST · JSON · MCP",
    h1: "API de validation IBAN",
    lead:
      "Un seul POST contrôle un IBAN comme un paiement en a besoin : la clé de contrôle et la structure du pays, puis la banque qui se trouve derrière, lue dans le registre national avec sa source et sa date.",
    facts: ["{countries} pays IBAN", "Banque et BIC avec leur source", "Premiers appels sans clé"],
    ctaKey: "Obtenir une clé API gratuite",
    ctaSandbox: "Essayer dans le bac à sable",
    ctaDocs: "Lire la documentation",
  },
  checks: {
    heading: "Ce qu'un appel vérifie",
    intro:
      "POST /v1/iban/validate répond par un seul objet JSON. Chaque contrôle a son propre champ : votre code lit exactement ce qui a été vérifié, et ce qui ne l'a pas été.",
    items: [
      {
        title: "Clé de contrôle",
        field: "checks.iban_checksum",
        body: "Le contrôle modulo 97 de la norme ISO 13616 sur les deux chiffres qui suivent le code pays. Un seul caractère mal saisi le fait échouer.",
      },
      {
        title: "Structure par pays",
        field: "checks.iban_structure",
        body: "La longueur et le découpage de la partie compte, pour chacun des {countries} pays du registre IBAN. Un IBAN invalide n'est pas une erreur HTTP : la réponse est un 200 avec valid: false et la raison.",
      },
      {
        title: "Clés nationales",
        field: "checks.national_check_digits",
        body: "Là où un pays place sa propre clé dans le numéro de compte : France et Monaco (clé RIB), Belgique, Italie et Saint-Marin (CIN), Espagne (DC), Royaume-Uni (modulus check) et numéro de règlement polonais. Une clé fausse apparaît dans ce champ et ne rend jamais valid faux.",
      },
      {
        title: "La banque et son BIC",
        field: "bank_code_check · bic.source · as_of",
        body: "Le code banque est cherché dans le registre national là où nous le lisons en entier : Allemagne, Autriche, Belgique, Slovaquie, République tchèque, Bulgarie, Suisse et Liechtenstein. Là, un code que le registre ne contient pas revient not_allocated. Ailleurs, un registre partiel ou une table composite nomme la banque, et la réponse précise qu'elle ne peut pas exclure un code. Le registre et la date de son édition accompagnent la réponse.",
      },
      {
        title: "SEPA et vérification du bénéficiaire",
        field: "sepa · risk_indicators.vop_coverage",
        body: "Les schémas SEPA qui atteignent la banque (virement, virement instantané, prélèvement), tirés des registres de l'EPC quand ils la listent et du pays sinon, avec la base indiquée. Et si le registre EPC de la vérification du bénéficiaire (VoP) liste la banque comme prête.",
      },
      {
        title: "Criblage de la banque, sur demande",
        field: "POST /v1/iban/compliance",
        body: "Un appel séparé confronte la banque du bénéficiaire (BIC8) aux listes OFAC, UE et ONU, contrôle le pays auprès du GAFI et d'une liste fixe de juridictions sanctionnées, et rend un score de risque de 0 à 100. Il est indicatif et ne crible jamais le nom du bénéficiaire.",
      },
    ],
  },
  notDo: {
    heading: "Ce qu'elle ne vous dit pas",
    items: [
      "Si le compte existe ou s'il est ouvert. Aucun registre ne le publie : seule la banque du bénéficiaire le sait.",
      "Au nom de qui est le compte. Ce contrôle, c'est la vérification du bénéficiaire, faite par sa banque ; l'API dit seulement si cette banque est listée comme prête.",
      "Si le bénéficiaire est sanctionné. Le criblage optionnel porte sur la banque et le pays, pas sur la personne ou l'entreprise que vous payez.",
      "Les méthodes allemandes de contrôle du numéro de compte et les clés nationales des pays qui ne sont pas cités plus haut : elles ne sont pas encore contrôlées.",
    ],
    sources: "Chaque registre, sa licence et la date de l'édition que nous lisons",
  },
  firstCall: {
    heading: "Votre premier appel",
    intro:
      "Copiez l'un de ces blocs tel quel. L'IBAN est l'exemple du bac à sable : un IBAN suisse valide qui mène à une vraie banque.",
    trial:
      "L'essai sans clé sert 25 validations par semaine sur POST /v1/iban/validate, comptées pour l'adresse d'où vient l'appel, semaine ISO en UTC, remise à zéro le lundi à 00:00 UTC.",
    tabsLabel: "Le même appel dans trois langages",
    answerHeading: "La réponse, telle que l'API l'a rendue",
    answerCaption:
      "Extrait de la réponse de l'API pour cet IBAN, le {date} : les champs qui disent ce qui a été contrôlé, et dans quel registre. La réponse complète porte aussi l'émetteur, les données de clearing suisses, les indicateurs de risque et l'étape suivante conseillée. Appelée sans clé, elle se termine par un bloc trial qui indique combien d'appels restent cette semaine et quand le compteur repart.",
    withKey:
      "Au-delà de l'essai sans clé, envoyez la même requête avec l'en-tête Authorization: Bearer ifk_… et votre clé.",
  },
  mod97: {
    heading: "Pourquoi le modulo 97 ne suffit pas",
    body:
      "L'exemple suisse officiel du registre IBAN, CH93 0076 2011 6238 5295 7, a une clé de contrôle juste. Son code banque n'est attribué à personne dans le SIX BankMaster, et l'API le dit :",
    caption: "Réponse de l'API pour cet IBAN, exportée le {date}.",
  },
  doors: {
    heading: "Commencer gratuitement, puis payer à l'usage",
    intro: "Trois entrées gratuites, chacune avec son propre quota. Aucune ne demande de carte.",
    trial: {
      tag: "Sans clé",
      title: "L'essai sans clé",
      body: "25 validations par semaine sur POST /v1/iban/validate, pour l'adresse d'où vient l'appel, à titre d'essai. Remise à zéro le lundi à 00:00 UTC.",
    },
    anonymous: {
      tag: "Clé, sans e-mail",
      title: "Une clé en un clic",
      body: "25 requêtes par mois, sur tous les endpoints. Un POST vide vers /v1/keys/generate, ou le bouton ci-dessous : sans e-mail, sans carte.",
    },
    claimed: {
      tag: "Clé, avec une adresse",
      title: "200 requêtes par mois",
      body: "Réclamez la même clé avec un code à six chiffres envoyé à une adresse que vous lisez, ou donnez l'adresse en la créant. Même clé, même préfixe, sans carte.",
    },
    keyCta: "Obtenir la clé gratuite",
    paidHeading: "Quand il en faut davantage",
    paid: [
      "Pro : 29 $ par mois pour 10 000 requêtes, remise à zéro le 1er, résiliable à tout moment.",
      "Packs de crédits qui n'expirent jamais, par carte ou en USDC : 1 000 crédits pour 4 $, 5 000 pour 20 $, 25 000 pour 80 $.",
      "x402 : paiement à l'appel en USDC sur Base, sans aucun compte, 0,005 $ par validation et 0,002 $ par IBAN dans un lot.",
    ],
    pricingLink: "Tous les tarifs et le calculateur de coût",
  },
  tools: {
    heading: "Tout ce qui entoure l'API",
    links: [
      { href: "/playground", title: "Bac à sable", body: "La vraie API dans votre navigateur, avec des IBAN d'exemple de plusieurs pays." },
      { href: "/docs/onboarding", title: "Prise en main", body: "De l'appel sans clé au lot de 100 IBAN, chaque bloc de la réponse sous son vrai nom." },
      { href: "/docs/iban-validate", title: "Référence de l'endpoint", body: "POST /v1/iban/validate, champ par champ, avec les codes d'erreur." },
      { href: "/openapi", title: "OpenAPI 3.1", body: "Le contrat, pour générer un client ou l'importer dans Postman." },
      { href: "https://www.npmjs.com/package/@ibanforge/sdk", title: "npm : @ibanforge/sdk", body: "Le SDK TypeScript et JavaScript." },
      { href: "https://pypi.org/project/ibanforge/", title: "PyPI : ibanforge", body: "Le SDK Python, clients synchrone et asynchrone." },
      { href: "/docs/mcp", title: "Serveur MCP", body: "ibanforge-mcp pour Claude, Cursor et les autres clients MCP, ou le point d'accès hébergé." },
      { href: "https://www.npmjs.com/package/n8n-nodes-ibanforge", title: "n8n", body: "Le nœud communautaire pour n8n auto-hébergé." },
    ],
  },
  closing: {
    heading: "Essayez-la sur vos propres IBAN",
    body: "Le bac à sable appelle la vraie API. Quand vous êtes prêt, prenez une clé : sans e-mail, sans carte.",
  },
};
