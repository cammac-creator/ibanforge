import type { GermanApiCopy } from './copy';

export const COPY_FR: GermanApiCopy = {
  meta: {
    title: 'API IBAN pour l\'Allemagne : registre Bundesbank, banque et BIC',
    description:
      'Quelle API contrôle les IBAN allemands et nomme la banque et le BIC ? IBANforge lit le fichier des codes de la Bundesbank. Réponses réelles, VoP et comparatif.',
    ogLocale: 'fr_FR',
  },
  breadcrumbHome: 'Accueil',
  hero: {
    eyebrow: 'Allemagne · Bundesbank · SEPA',
    h1: 'Quelle API contrôle les IBAN allemands et nomme la banque et le BIC ?',
    answer:
      'IBANforge contrôle un IBAN allemand en un appel avec le fichier des codes bancaires de la Deutsche Bundesbank (lu en dernier en {asOf}) : la structure et la clé, la Bankleitzahl dans le registre, la clé du numéro de compte selon la méthode de la Bundesbank, puis la banque et le BIC tirés du même fichier. Si la Bankleitzahl n\'est pas au registre, la réponse est not_allocated avec authoritative: true : aucune banque ne porte ce code.',
    limit:
      'L\'API ne compare pas le nom du titulaire et ne dit pas si le compte existe. La comparaison du nom est la vérification du bénéficiaire, faite par les banques.',
    interest: 'Nous vendons IBANforge. Le comparatif plus bas dit aussi quand un autre fournisseur est le meilleur choix.',
    tryIt: 'Essayer dans le bac à sable',
    compare: 'Aller au comparatif',
  },
  need: {
    heading: 'Ce qu\'une API doit faire pour un IBAN allemand',
    intro:
      'Une clé correcte prouve seulement que les caractères vont ensemble. Un contrôle utile répond aussi aux questions ci-dessous, et dit d\'où vient chaque réponse.',
    cols: { check: 'La question', source: 'D\'où vient la réponse', field: 'Champ de la réponse' },
    rows: [
      {
        check: 'L\'IBAN est-il bien formé ?',
        source: 'ISO 13616 : 22 caractères, clé modulo 97',
        field: 'valid',
      },
      {
        check: 'La Bankleitzahl est-elle attribuée ?',
        source: 'Le fichier des codes de la Bundesbank',
        field: 'bank_code_check',
      },
      {
        check: 'La clé du numéro de compte est-elle juste ?',
        source: 'La méthode que la Bundesbank associe à la Bankleitzahl',
        field: 'national_check_digits',
      },
      {
        check: 'Quelle banque, quel BIC ?',
        source: 'La même ligne du fichier des codes',
        field: 'bank_code_check.institution, bic',
      },
      {
        check: 'Quels schémas SEPA, quel statut VoP pour la banque ?',
        source: 'Les registres de l\'European Payments Council, sinon le pays (la réponse dit lequel)',
        field: 'sepa',
      },
    ],
  },
  bundesbank: {
    heading: 'Ce que nous lisons à la Bundesbank',
    items: [
      {
        title: 'Le fichier des codes, avec sa date',
        body: 'La Bundesbank attribue les Bankleitzahlen et met à jour ses données chaque trimestre, en mars, juin, septembre et décembre. Nous relisons le fichier chaque mois, en dernier en {asOf} : {count} codes, dont {retired} marqués pour suppression. Dans chaque réponse, as_of nomme le mois de cette lecture, pas une date de validité de la Bundesbank.',
      },
      {
        title: 'Un code absent pèse lourd',
        body: 'Comme la Bundesbank attribue elle-même les codes, une absence est un fait sur l\'Allemagne et non sur nos données : status not_in_register, reason not_allocated, authoritative true. Là où nous ne lisons pas de registre complet, la même absence s\'appelle absent_from_reference_data et n\'écarte rien.',
      },
      {
        title: 'La clé du numéro de compte',
        body: 'Le fichier associe une méthode de calcul de clé (Prüfzifferberechnungsmethode) à chaque Bankleitzahl. La réponse la nomme dans national_check_digits.method, avec le résultat et la source. Une clé fausse ne fait jamais passer valid à faux. Avec une méthode que la Bundesbank publie sans numéros de test, elle n\'est qu\'un avertissement, et une méthode que nous ne savons pas contrôler de façon fiable reste not_checked.',
      },
      {
        title: 'Le BIC et sa source',
        body: 'Le fichier porte le BIC à côté de la Bankleitzahl. bic.source nomme le fichier, et bic.basis: national_register dit que le BIC y a été lu et non deviné.',
      },
      {
        title: 'Les codes qui s\'arrêtent',
        body: 'Quand la Bundesbank marque une Bankleitzahl pour suppression, la réponse porte retired: true et, si le registre nomme un successeur, superseded_by. Un contrôle de format ne le voit pas.',
      },
    ],
    credit: 'Quelle: Deutsche Bundesbank, Bankleitzahlendatei, lu en {asOf}.',
    scheduleLink: 'Les dates de mise à jour à la Bundesbank (en allemand)',
    scheduleRead: 'lu le {date}',
  },
  examples: {
    heading: 'Deux réponses',
    intro: 'Ces valeurs ne sont pas tapées à la main : à la construction de cette page, elles viennent du fichier de la Bundesbank que nous avons lu en {asOf}.',
    allocatedTitle: 'Une Bankleitzahl attribuée',
    allocatedNote:
      'DE89 3704 0044 0532 0130 00 est l\'IBAN modèle de nombreux tutoriels. La Bankleitzahl 37040044 appartient à la Commerzbank, et le BIC vient du même fichier. Cela ne dit rien du compte lui-même.',
    missingTitle: 'Une Bankleitzahl que personne ne porte',
    missingNote:
      'La clé de cet IBAN est juste, donc valid reste vrai. Seul le registre montre que la Bundesbank n\'a pas attribué 99999999. next_steps en fait une action sur laquelle un logiciel peut se brancher.',
    curlTitle: 'L\'appeler vous-même, sans clé d\'API',
    curlNote: 'En production, prenez une clé d\'API.',
    keyLink: 'Prix et allocations',
    extract: 'Extrait de la réponse',
  },
  vop: {
    heading: 'Vérification du bénéficiaire (VoP) : ce qui est obligatoire, et ce que nous en disons',
    what: {
      title: 'Ce que c\'est',
      body: 'Avant un virement, le nom du bénéficiaire saisi est comparé au nom qui correspond à l\'IBAN. Cela vaut pour les virements SEPA et les virements SEPA instantanés entre comptes de paiement. La base est l\'article 5c du règlement SEPA, inséré par le règlement (UE) 2024/886.',
    },
    duty: {
      title: 'À qui revient l\'obligation',
      body: 'Aux prestataires de paiement de la zone euro, depuis le 9 octobre 2025 : la banque du payeur demande, la banque du bénéficiaire répond. Une entreprise qui soumet ses virements en lot doit pouvoir y renoncer. Cette page n\'est pas un conseil juridique.',
    },
    says: {
      title: 'Ce qu\'IBANforge en dit',
      body: 'Si la banque identifiée figure au registre VoP de l\'European Payments Council : sepa.vop_participant et sepa.vop_register_status, avec register_source et register_as_of quand le registre a été lu pour cette banque. C\'est une indication sur la banque, pas sur le compte.',
    },
    not: {
      title: 'Ce qu\'IBANforge ne fait pas',
      body: 'Comparer un nom. L\'API ne répond jamais Match ou No Match et ne remplace pas le contrôle de votre banque. Un false ou un null dans les champs VoP n\'est pas un résultat sur un nom.',
    },
    sourcesTitle: 'Sources',
    readOn: 'lu le {date}',
    sources: [
      {
        label: 'BaFin : vérification du bénéficiaire (en allemand)',
        url: 'https://www.bafin.de/DE/verbraucherinnen-verbraucher/themen-finanzprodukte/konten-zahlungen/zahlungen/ueberweisungen-und-lastschriften/empfaengerueberpruefung/empfaengerueberpruefung.html',
        read: 'authorities',
      },
      {
        label: 'BaFin : questions et réponses sur le règlement des virements instantanés (en allemand)',
        url: 'https://www.bafin.de/SharedDocs/Fragen-antworten/DE/faq-voechtzeitueberweisungen/faq-voechtzeitueberweisungen_node.html',
        read: 'authorities',
      },
      {
        label: 'Deutsche Bundesbank : questions et réponses sur les virements instantanés et la vérification du bénéficiaire (en allemand)',
        url: 'https://www.bundesbank.de/dynamic/action/de/aufgaben/unbarer-zahlungsverkehr/veroeffentlichungen/fragen-und-antworten-zu-echtzeitueberweisungen-und-empfaengerueberpruefung/963980/fragen-und-antworten-zu-echtzeitueberweisungen-und-empfaengerueberpruefung-',
        read: 'authorities',
      },
      {
        label: 'Règlement (UE) 2024/886, EUR-Lex, version anglaise',
        url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R0886',
        read: 'regulation',
      },
    ],
    docsLink: 'Les champs VoP en détail',
  },
  comparison: {
    heading: 'Le comparatif pour les IBAN allemands',
    interest:
      'Nous vendons IBANforge ; lisez ce comparatif en le sachant. Chaque indication sur un autre fournisseur vient de ses pages publiques, lues le {readOn}. Ce que nous n\'avons pas vérifié le dit. Si quelque chose est faux ou si un prix a changé, écrivez à support@ibanforge.com.',
    bankCode: 'Code banque dans le registre national',
    prices: 'Le calcul, prix lus le {readOn}',
    ourPrices: 'Prix',
    libsName: 'Bibliothèques open source',
    libsBetter: 'Quand une bibliothèque est le meilleur choix',
    vendorLink: 'Le comparatif complet avec {name}',
    ourLink: 'Tous les prix',
    tableLink: 'Tous les fournisseurs dans un tableau',
  },
  europe: {
    heading: 'La même logique dans toute l\'Europe',
    full: 'Les registres de l\'Allemagne, de l\'Autriche, de la Belgique, de la Slovaquie, de la Tchéquie, de la Bulgarie, de la Suisse et du Liechtenstein sont lus en entier. Là, un code absent revient en not_allocated.',
    elsewhere:
      'Dans le reste des {countries} pays IBAN, un registre partiel ou une table composite nomme la banque, et la réponse dit qu\'elle ne peut pas écarter un code. Un appel en lot prend jusqu\'à 100 IBAN.',
    link: 'Formats d\'IBAN et registres par pays',
  },
  next: {
    heading: 'Pour aller plus loin',
    finder: 'À quelle banque appartient cet IBAN ? Sans code, dans le navigateur',
    register: 'Chaque Bankleitzahl sur sa propre page',
    docs: 'Le contrôle BLZ dans la documentation',
    article: 'Exemple en Python et JavaScript',
    alternatives: 'Alternatives, une page par fournisseur',
  },
};
