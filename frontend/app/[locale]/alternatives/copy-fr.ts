import type { AlternativesCopy } from './copy';

// Une phrase par ligne là où un chiffre apparaît : les gardes de prose du dépôt
// de l'API lisent ce fichier ligne par ligne et phrase par phrase.
export const COPY_FR: AlternativesCopy = {
  ogLocale: 'fr_FR',
  breadcrumbHome: 'Accueil',
  breadcrumbIndex: 'Alternatives',
  eyebrow: 'Côte à côte',
  disclosure:
    'Nous vendons IBANforge : lisez cette page en le sachant. Chaque fait sur {name} vient de ses pages publiques, relues le {readOn} et citées en bas de page. Si une information est fausse ou si un prix a changé, écrivez à support@ibanforge.com et nous corrigerons.',
  labels: {
    strengths: 'Ce que {name} fait bien',
    theirPrices: 'Les prix de {name}',
    readOn: 'Tels que ses pages les affichaient le {readOn}.',
    ourPricesNote: 'Prix en vigueur, les mêmes que sur la page des tarifs.',
    allPrices: 'Tous les tarifs et le calculateur de coût',
    calculation: 'Calcul',
    betterFor: 'Quand {name} est le meilleur choix',
    sources: 'Sources, relues le {readOn}',
    next: 'Aller plus loin',
    compare: 'Comparaison complète',
    compareBody: 'IBANforge, AbstractAPI, iban.com, IBANAPI et les bibliothèques open source dans un même tableau.',
    api: 'API de validation IBAN',
    apiBody: 'Ce qu’un appel vérifie, et le premier appel en curl, Python et JavaScript.',
    sandbox: 'Bac à sable',
    sandboxBody: 'La vraie API dans votre navigateur, avec des IBAN d’exemple.',
  },
  ours: {
    heading: 'Ce qu’IBANforge fait autrement',
    items: [
      'Le code banque est vérifié dans le registre national là où nous le lisons en entier : Allemagne (Deutsche Bundesbank, édition de {deAsOf}), Suisse et Liechtenstein (SIX BankMaster, valable dès le {chAsOf}), Autriche, Belgique, Slovaquie, Tchéquie et Bulgarie. Là, un code que le registre ne contient pas revient not_allocated, avec authoritative: true.',
      'Chaque réponse nomme ses sources : le registre du verdict sur le code banque, la source du BIC et l’édition lue (bank_code_check.register, bic.source, as_of).',
      'Les clés nationales cachées dans le numéro de compte, là où un pays en a : France et Monaco (clé RIB), Belgique, Italie et Saint-Marin (CIN), Espagne (DC) et Royaume-Uni (modulus check).',
      'Pensé pour les agents IA : un serveur MCP, hébergé ou en paquet ibanforge-mcp, et x402, qui permet à un agent de payer chaque appel en USDC sur Base, sans compte.',
      'Un essai sans clé de 25 validations par semaine sur POST /v1/iban/validate, pour essayer avant de prendre une clé.',
    ],
    limitsHeading: 'Ce qu’IBANforge ne fait pas',
    limits: [
      'Vérifier le nom du titulaire du compte. C’est la vérification du bénéficiaire (Verification of Payee), faite par la banque du bénéficiaire.',
      'Vérifier les méthodes allemandes du numéro de compte, ni les clés nationales des pays non cités plus haut : pas encore.',
      'Dire si le compte existe ou s’il est ouvert. Aucun registre ne le publie.',
    ],
    pricesHeading: 'Les prix d’IBANforge',
    free: [
      'Essai sans clé : 25 validations par semaine sur POST /v1/iban/validate.',
      'Clé gratuite : 200 requêtes par mois une fois réclamée avec une adresse e-mail, sur toutes les routes, sans carte.',
    ],
    paid: [
      'Pro : 29 $ par mois pour 10 000 requêtes, résiliable à tout moment.',
      'Packs de crédits qui n’expirent jamais : 1 000 crédits pour 4 $, 5 000 pour 20 $, 25 000 pour 80 $.',
      'x402 : 0,005 $ par validation et 0,002 $ par IBAN dans un lot, en USDC sur Base, sans compte.',
    ],
  },
  index: {
    meta: {
      title: 'Alternatives aux API IBAN : IBANAPI, iban.com, AbstractAPI',
      description:
        'Alternatives à IBANAPI, iban.com et AbstractAPI pour valider des IBAN : ce que chacun fait bien, ce qu’IBANforge fait autrement, et les deux grilles de prix, datées.',
    },
    h1: 'Alternatives aux API de validation IBAN',
    lead:
      'Une page par fournisseur auquel on nous compare : ce qu’il fait bien, ce qu’IBANforge fait autrement, les deux grilles de prix avec le jour où elles ont été relues, et quand l’autre est le meilleur choix.',
    cardCta: 'Lire la comparaison',
    compareLine: 'Tous dans un même tableau, avec les bibliothèques open source :',
  },
  fromCompare: {
    heading: 'Une page par fournisseur',
    body: 'IBANAPI, iban.com et AbstractAPI, chacun à côté d’IBANforge : points forts, prix, et quand choisir l’un ou l’autre.',
  },
  vendors: {
    ibanapi: {
      meta: {
        title: 'Alternative à IBANAPI : prix et différences, côte à côte',
        description:
          'Vous cherchez une alternative à IBANAPI ? Ce qu’IBANAPI fait bien, ce qu’IBANforge fait autrement (registres nationaux, MCP, x402) et les deux grilles de prix, datées.',
      },
      h1: 'Une alternative à IBANAPI',
      lead:
        'IBANAPI est une API de validation IBAN avec une offre gratuite et une version auto-hébergée. Si vous la comparez à IBANforge, voici ce que fait chacune, avec les prix des deux.',
      summary: 'Une offre gratuite qui se renouvelle, un moteur auto-hébergeable, des crédits liés à une période.',
      strengths: [
        'Une offre gratuite sans carte bancaire : 100 crédits de base et 20 crédits de recherche bancaire par 30 jours, et l’offre gratuite se renouvelle automatiquement.',
        'Une version auto-hébergée : IBANAPI indique que son moteur de validation peut tourner dans votre propre infrastructure, sans appel facturé à la requête.',
        'Pour certains pays, IBANAPI annonce un contrôle du numéro de compte national lui-même.',
        'IBANAPI annonce 90 pays, avec des noms de banque et des BIC issus de registres de banques centrales. Il résout le code banque de l’IBAN dans son propre registre, construit à partir des banques centrales, de données SEPA et d’une relecture manuelle, et renvoie le BIC là où il est disponible.',
      ],
      prices: [
        'Free : 0 $ pour 30 jours, avec 100 crédits de base et 20 crédits de recherche bancaire.',
        'Professional : 15 $ pour 60 jours, avec 2 000 crédits de base et 400 crédits de recherche bancaire.',
        'Business : 40 $ pour 180 jours, avec 7 000 crédits de base et 1 500 crédits de recherche bancaire.',
        'Enterprise : 115 $ pour 365 jours, avec 30 000 crédits de base et 5 000 crédits de recherche bancaire.',
        'Chaque validation consomme 1 crédit de base ; un appel qui résout aussi les données bancaires consomme en plus 1 crédit de recherche bancaire. Les crédits sont liés à la période de l’offre.',
      ],
      calculation:
        'Pour 2 000 validations avec données bancaires, d’après les prix publiés : chez IBANforge, 8 $ de crédits prépayés (deux packs de 1 000) qui n’expirent jamais. Chez IBANAPI, la plus petite offre unique qui compte 2 000 recherches bancaires est Enterprise, 115 $ pour 365 jours, qui en inclut 5 000. Les achats répétés d’une offre plus petite ne sont pas comparés ici.',
      betterFor: [
        'Vous voulez faire tourner le moteur de validation dans votre propre infrastructure.',
        'Il vous faut le contrôle du numéro de compte national dans les pays où IBANAPI l’annonce. IBANforge ne vérifie pas encore les méthodes allemandes du numéro de compte.',
      ],
      note:
        'Ce que signifie un code banque absent du registre d’IBANAPI (attribué à personne, ou simplement pas répertorié) n’est pas dit sur les pages que nous avons lues.',
    },
    'iban-com': {
      meta: {
        title: 'Alternative à iban.com : prix d’IBAN Suite et différences',
        description:
          'Vous cherchez une alternative à iban.com ? Ce qu’IBAN Suite fait bien (BIC sous licence SWIFT, vérification du bénéficiaire), ce qu’IBANforge fait autrement, prix datés.',
      },
      h1: 'Une alternative à iban.com',
      lead:
        'iban.com vend IBAN Suite, un service de validation et de données bancaires sous licence annuelle, et un service distinct de vérification du bénéficiaire. Si vous le comparez à IBANforge, voici ce que fait chacun, avec les prix des deux.',
      summary: 'BIC sous licence SWIFT, vérification du bénéficiaire, sort codes britanniques, licences annuelles.',
      strengths: [
        'IBAN Suite identifie le BIC et les données bancaires derrière un IBAN, avec des données BIC sous licence de S.W.I.F.T., et annonce la joignabilité SEPA et les schémas pris en charge.',
        'Bank Account Verification (BAV), qu’iban.com appelle aussi Verification of Payee, vérifie le nom du titulaire et répond Match, No Match, Close Match ou Unavailable, dans 21 pays listés.',
        'SORTware, un service distinct pour les sort codes et numéros de compte du Royaume-Uni et d’Irlande.',
        'Des conditions, une politique de confidentialité, un DPA et un SLA publiés, et une limite de débit annoncée de 15 requêtes par seconde par adresse IP et par clé.',
        'Un essai gratuit par inscription en ligne : 100 requêtes, actif un mois. Les licences s’achètent en ligne, ou sur facture auprès de l’équipe commerciale.',
      ],
      prices: [
        'IBAN Suite, par an : Professional 530 € pour 2 000 requêtes, Business 1 450 € pour 20 000, Corporate 2 350 € pour 50 000, Enterprise 4 150 € en illimité.',
        'Les licences durent un an au minimum, et la TVA n’est pas comprise.',
        'BAV (vérification du bénéficiaire), par paquet : 2 500 vérifications pour 2 000 €, 10 000 pour 7 000 €, 20 000 pour 12 000 €, 50 000 pour 25 000 €.',
        'SORTware : 2 800 € par an, en illimité.',
      ],
      calculation:
        'Pour 2 000 validations avec données bancaires, d’après les prix publiés : chez IBANforge, 8 $ de crédits prépayés (deux packs de 1 000) qui n’expirent jamais. Chez iban.com, la licence Professional comprend 2 000 requêtes par an pour 530 €, hors TVA.',
      betterFor: [
        'Vous devez vérifier le nom du titulaire du compte (vérification du bénéficiaire). IBANforge ne le fait pas : il vérifie la banque derrière l’IBAN, pas la personne.',
        'Vous validez des sort codes et des numéros de compte britanniques ou irlandais.',
        'Vous voulez des données BIC sous licence SWIFT, et un contrat annuel payable sur facture.',
      ],
      note:
        'iban.de, qui se dit propulsé par iban.com pour ses services IBAN et BIC, nomme dans ses mentions légales la société que les conditions d’iban.com désignent comme concédant de licence. Il affiche de 420 € à 3 800 € par an pour une durée d’un an, et un essai gratuit de 100 requêtes actif un mois.',
    },
    abstractapi: {
      meta: {
        title: 'Alternative à AbstractAPI pour les IBAN : prix et différences',
        description:
          'Une alternative à AbstractAPI pour valider des IBAN ? Ce que renvoie chacune, les offres des deux avec leur date, et quand AbstractAPI reste le meilleur choix.',
      },
      h1: 'Une alternative à AbstractAPI pour les IBAN',
      lead:
        'L’API IBAN Validation d’AbstractAPI répond si un IBAN est valide. Si vous la comparez à IBANforge, voici ce que renvoie chacune, avec les offres des deux.',
      summary: 'Un booléen de validité, des débits élevés, une offre Enterprise avec SLA.',
      strengths: [
        'Une réponse courte, simple à brancher : la réponse documentée porte l’IBAN et is_valid.',
        'Des débits élevés : 25 requêtes par seconde en Standard, 100 sur les paliers supérieurs.',
        'Une offre Enterprise, sur devis, dont la carte annonce un SLA de disponibilité de 99,99 %.',
        'Une offre gratuite de 100 requêtes, à 1 requête par seconde.',
      ],
      prices: [
        'Standard, facturé à l’année (la vue affichée par défaut) : 63 $ par mois pour 60 000 requêtes par an.',
        'Standard, facturé au mois : 69 $ par mois pour 5 000 requêtes par mois.',
        'Paliers supérieurs : 182 $ par mois facturés à l’année pour 240 000 requêtes par an, ou 199 $ par mois pour 20 000 par mois.',
        'Puis 457 $ par mois facturés à l’année pour 600 000 requêtes par an, ou 499 $ par mois pour 50 000 par mois.',
        'Gratuit : 100 requêtes, à 1 requête par seconde.',
      ],
      calculation:
        'Les deux réponses ne couvrent pas le même terrain : AbstractAPI ne documente ni BIC ni nom de banque dans sa réponse, IBANforge nomme la banque et son BIC. Pour le seul volume, d’après les prix publiés : 5 000 validations coûtent 69 $ pour un mois chez AbstractAPI (Standard, facturé au mois) et 20 $ chez IBANforge (un pack de 5 000 crédits, sans expiration).',
      betterFor: [
        'Il vous suffit de savoir si un IBAN est bien formé, avec un débit élevé d’appels unitaires : Standard annonce 25 requêtes par seconde. IBANforge accepte 100 requêtes par minute et par adresse IP, avec jusqu’à 100 IBAN dans un appel par lot.',
        'Vous voulez une offre Enterprise dont la carte annonce un SLA de disponibilité de 99,99 %.',
      ],
    },
  },
};
