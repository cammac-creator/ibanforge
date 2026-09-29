import type { WelcheBankCopy } from './copy';

export const COPY_FR: WelcheBankCopy = {
  meta: {
    title: 'À quelle banque appartient cet IBAN ? Trouver le code banque',
    description:
      'À quelle banque appartient cet IBAN ? Pas aux deux chiffres après DE : c’est une clé de contrôle. La banque est dans la Bankleitzahl, positions 5 à 12. Trouvez-la ici.',
    ogLocale: 'fr_FR',
  },
  breadcrumbHome: 'Accueil',
  hero: {
    eyebrow: 'IBAN · code banque · clé de contrôle',
    h1: 'À quelle banque appartient cet IBAN ?',
    lead:
      'La banque est écrite dans l’IBAN lui-même : dans un IBAN allemand, aux positions 5 à 12, la Bankleitzahl. Les deux chiffres juste après DE sont une clé de contrôle et ne désignent aucune banque.',
  },
  finder: {
    label: 'Saisissez ou collez un IBAN (le début suffit)',
    placeholder: 'DE89 3704 0044 0532 0130 00',
    privacy:
      'L’IBAN est lu dans votre navigateur. Il n’est envoyé nulle part et l’API n’est pas appelée. Seul un clic ouvre la page du code banque, et son adresse ne porte que ce code.',
    example: 'Exemple : DE89 3704 0044 0532 0130 00. La Bankleitzahl est 37040044.',
    partialTitle: '{cd} est une clé de contrôle, pas une banque',
    partialStart: 'Continuez : le code de la banque commence à la position 5.',
    partialBody: {
      DE: 'Les deux chiffres après DE sont calculés à partir de tous les autres caractères, pour qu’une faute de frappe se voie. La banque est dans la Bankleitzahl, les huit chiffres qui suivent (positions 5 à 12). Tapez au moins {needed} caractères.',
      AT: 'Les deux chiffres après AT sont calculés à partir de tous les autres caractères, pour qu’une faute de frappe se voie. La banque est dans la Bankleitzahl, les cinq chiffres qui suivent (positions 5 à 9). Tapez au moins {needed} caractères.',
      CH: 'Les deux chiffres après CH sont calculés à partir de tous les autres caractères, pour qu’une faute de frappe se voie. La banque est dans l’IID (numéro de clearing), les cinq chiffres qui suivent (positions 5 à 9). Tapez au moins {needed} caractères.',
      LI: 'Les deux chiffres après LI sont calculés à partir de tous les autres caractères, pour qu’une faute de frappe se voie. La banque est dans l’IID, les cinq chiffres qui suivent (positions 5 à 9). Tapez au moins {needed} caractères.',
    },
    codeName: {
      DE: 'Bankleitzahl',
      AT: 'Bankleitzahl',
      CH: 'IID (numéro de clearing)',
      LI: 'IID (numéro de clearing)',
    },
    status: {
      deAllocated: 'Inscrite au registre de la Deutsche Bundesbank (édition de {asOf}). Sa page nomme la banque et son BIC.',
      deRetired: 'Inscrite au registre de la Deutsche Bundesbank (édition de {asOf}), où elle est marquée pour suppression.',
      deRetiredSuccessor: 'La Bundesbank désigne la Bankleitzahl {successor} comme successeur.',
      deMissing:
        'Absente du registre de la Deutsche Bundesbank (édition de {asOf}) : aucune banque ne détient ce code. Vérifiez l’IBAN.',
      atUnchecked:
        'Lue aux positions 5 à 9. Sa page nomme la banque lorsque l’annuaire de l’Oesterreichische Nationalbank inscrit ce code.',
      chAllocated: 'Inscrit au SIX BankMaster (valable dès le {asOf}). Sa page nomme la banque et son BIC.',
      chMissing:
        'Absent du SIX BankMaster (valable dès le {asOf}) : aucun établissement ne détient cet IID. Vérifiez l’IBAN.',
    },
    checksum: {
      pass: 'Clé {cd} : elle correspond. L’IBAN n’a pas de faute de frappe que le contrôle modulo 97 détecterait.',
      fail: 'Clé {cd} : elle ne correspond pas au reste. Il y a une faute de frappe quelque part, peut-être dans le code banque lui-même.',
      incomplete: 'Clé {cd} : contrôlée dès que l’IBAN est complet ({length} caractères).',
    },
    bareBlz: 'Huit chiffres sans code pays : lus comme une Bankleitzahl allemande.',
    open: 'Ouvrir la page : {code}',
    openSuccessor: 'Ouvrir le successeur {successor}',
    errors: {
      characters: 'Un IBAN ne contient que des lettres et des chiffres, et deux chiffres suivent le code pays.',
      country: 'Commencez par les deux lettres du pays (DE, AT, CH ou LI), ou tapez les huit chiffres d’une Bankleitzahl.',
      tooLong: 'Plus long qu’un IBAN de {country} ({length} caractères) : vérifiez ce qui a été collé.',
    },
    unsupported:
      '{country} : ce champ lit les IBAN d’Allemagne, d’Autriche, de Suisse et du Liechtenstein. Pour les autres pays, le bac à sable vérifie un IBAN avec l’API ; l’IBAN est alors envoyé à l’API.',
    unsupportedLink: 'Aller au bac à sable',
  },
  anatomy: {
    heading: 'Comment un IBAN allemand est construit',
    intro: 'Toujours 22 caractères, toujours dans cet ordre. L’exemple est l’IBAN type que citent de nombreux guides.',
    parts: {
      country: { label: 'Code pays', note: 'DE pour l’Allemagne' },
      check: { label: 'Clé de contrôle', note: 'Pas une banque : calculée à partir de tous les autres caractères' },
      bank: { label: 'Bankleitzahl', note: 'La banque : ici Commerzbank, Cologne' },
      account: { label: 'Numéro de compte', note: 'Dix chiffres, complétés à gauche par des zéros' },
    },
  },
  trap: {
    heading: 'Pourquoi « DE55 » n’est pas une banque',
    paragraphs: [
      'Beaucoup cherchent « DE55 welche Bank » ou « DE87 welche Bank » (quelle banque est DE55 ?). Les chiffres après DE sont la clé de contrôle de la norme ISO 13616 : ils sont calculés par la méthode modulo 97 à partir de tous les autres caractères de l’IBAN. Qu’un seul caractère change, et la clé ne correspond plus : l’IBAN apparaît comme erroné.',
      'C’est pourquoi n’importe quelle banque peut se trouver derrière DE55, comme derrière toute autre clé. Deux clients d’une même banque ont presque toujours des clés différentes, parce que leurs numéros de compte diffèrent.',
      'La banque se lit dans la Bankleitzahl : les huit chiffres à partir de la position 5. La Deutsche Bundesbank attribue ces codes et les publie dans son registre, la Bankleitzahlendatei, avec le nom de la banque, sa ville et son BIC.',
    ],
  },
  countries: {
    heading: 'Autriche, Suisse, Liechtenstein',
    intro: 'La même idée, d’autres longueurs. Le champ ci-dessus lit les quatre pays.',
    cols: { country: 'Pays', length: 'Longueur', position: 'Code banque', code: 'Nom', register: 'Registre' },
    rows: [
      { cc: 'DE', country: 'Allemagne', code: 'Bankleitzahl', register: 'Deutsche Bundesbank' },
      { cc: 'AT', country: 'Autriche', code: 'Bankleitzahl', register: 'Oesterreichische Nationalbank' },
      { cc: 'CH', country: 'Suisse', code: 'IID (numéro de clearing)', register: 'SIX BankMaster' },
      { cc: 'LI', country: 'Liechtenstein', code: 'IID (numéro de clearing)', register: 'SIX BankMaster' },
    ],
    positions: 'positions {from} à {to}',
  },
  tells: {
    heading: 'Ce que le code banque dit, et ce qu’il ne dit pas',
    yes: [
      'Quelle banque tient le compte, avec sa ville et son BIC, tels que le registre les nomme.',
      'Si le code est attribué. Un code que la Bundesbank n’inscrit pas n’appartient à aucune banque.',
    ],
    no: [
      'Si le compte existe ou s’il est ouvert. Seule la banque du bénéficiaire le sait.',
      'À qui appartient le compte. Les banques comparent le nom au moment du virement (vérification du bénéficiaire, Verification of Payee).',
    ],
  },
  developers: {
    heading: 'Vérifier depuis un logiciel',
    body: 'Pour vérifier beaucoup d’IBAN, dans un fichier clients ou avant un lot de paiements, l’API lit le même registre : clé, banque, BIC, le verdict du registre avec sa source et son édition, dans une réponse JSON.',
    api: 'API de validation IBAN',
    sandbox: 'Essayer dans le bac à sable',
    article: 'Exemple en Python et en JavaScript',
  },
  sources: {
    de: 'Source : Deutsche Bundesbank, Bankleitzahlendatei, édition de {asOf}.',
    ch: 'Source : SIX BankMaster, valable dès le {asOf}.',
    at: 'Autriche : le champ lit seulement les positions 5 à 9 ; la page d’un code interroge le registre à son ouverture.',
  },
};
