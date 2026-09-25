/**
 * Les textes des pages du registre italien (/it et /it/{code}), dans les trois
 * langues du site.
 *
 * Ici plutôt que dans `messages/*.json`, et c'est voulu (25/09/2026) : ces
 * fichiers sont le chantier d'une autre session au même moment, et deux
 * sessions qui écrivent le même fichier sont la panne que ce dépôt a déjà payée.
 * Les textes communs à toutes les pages de registre (`registers.common.*`) sont
 * repris des messages, lus seulement. Le type impose les mêmes clés dans les
 * trois langues ; `it-register-copy.test.ts` vérifie qu'aucune n'est vide.
 *
 * Aucune mise en forme par `Intl` ici : ces fonctions ne font que coller des
 * chaînes, et les dates restent écrites comme la source les donne (AAAA-MM-JJ).
 */

export interface ItRegisterCopy {
  eyebrow: string;
  indexTitle: string;
  indexIntro: (inForce: number) => string;
  inForceTitle: string;
  retiredHint: string;
  notExhaustiveTitle: string;
  notExhaustive: string;
  title: (code: string) => string;
  metaTitle: (code: string, name: string, town: string) => string;
  metaDescription: (code: string, name: string, town: string) => string;
  retiredMetaTitle: (code: string, name: string) => string;
  retiredMetaDescription: (code: string, name: string, date: string) => string;
  retiredTitle: string;
  retiredText: (date: string) => string;
  successorText: (name: string, code: string) => string;
  noSuccessorText: string;
  successorLink: (code: string) => string;
  facts: {
    code: string;
    status: string;
    inForce: string;
    retired: string;
    holder: string;
    lastHolder: string;
    retiredOn: string;
    successor: string;
    street: string;
    postCode: string;
    town: string;
    lei: string;
    none: string;
  };
  structure: string;
  docLink: string;
  countryLink: string;
  /** La ligne « ce que l'API vérifie » de la page pays, pour un registre partiel. */
  partialRegisterCheck: (register: string) => string;
}

const en: ItRegisterCopy = {
  eyebrow: "Banca d'Italia registers",
  indexTitle: "Italian bank codes (ABI) in the Banca d'Italia registers",
  indexIntro: (n) =>
    `The ${n} ABI codes the Banca d'Italia lists in force today: banks, payment institutions and e-money institutions, each with its registered office in Italy and the exact answer of the IBANforge API. Re-read every week.`,
  inForceTitle: "Codes in force",
  retiredHint:
    "The codes the Banca d'Italia has struck off have a page too, with the date and the legal successor: type one above (03111, for example).",
  notExhaustiveTitle: "What a missing code does NOT mean",
  notExhaustive:
    "The Banca d'Italia lists the banks, payment institutions and e-money institutions it registers, not the allocation of the ABI code space. Poste Italiane (07601), the Banca d'Italia itself (01000) and the Italian branches of EU payment institutions issue real Italian IBANs outside these registers. So a code listed here names its holder, and a code absent from them proves nothing: the API answers authoritative: false for Italy, and an absence is never a reason to stop a payment.",
  title: (code) => `Italian bank code ${code}`,
  metaTitle: (code, name, town) => `Italian bank code ${code}: ${name}, ${town}`,
  metaDescription: (code, name, town) =>
    `ABI code ${code} in the Banca d'Italia registers: ${name}, ${town}. Registered office, LEI, IBAN structure and the exact answer of the IBANforge API.`,
  retiredMetaTitle: (code, name) => `Italian bank code ${code}: ${name}, struck off`,
  retiredMetaDescription: (code, name, date) =>
    `ABI code ${code} (${name}) was struck off the Banca d'Italia registers on ${date}. Its legal successor, the IBAN structure and the exact answer of the IBANforge API.`,
  retiredTitle: "A code the Banca d'Italia has struck off",
  retiredText: (date) =>
    `The register lists this code for the last time on ${date}. The API answers verified with retired: true and serves no BIC, since nobody holds this code today. It is not a refusal: how long an old IBAN stays reachable after a merger is not published, so ask the beneficiary for their current details.`,
  successorText: (name, code) =>
    `Legal successor by merger or incorporation: ${name} (${code}). It is not necessarily the bank that holds the account today: a bank may transfer branches to another bank before it is absorbed.`,
  noSuccessorText:
    "The register names no legal successor: the institution was liquidated, or its business was transferred rather than merged.",
  successorLink: (code) => `The page of code ${code}`,
  facts: {
    code: "ABI code",
    status: "Status",
    inForce: "in force",
    retired: "struck off",
    holder: "Institution",
    lastHolder: "Last holder",
    retiredOn: "Last listed on",
    successor: "Legal successor",
    street: "Registered office in Italy",
    postCode: "Postcode",
    town: "Town",
    lei: "LEI",
    none: "none",
  },
  structure:
    "An Italian IBAN is IT, two check digits, one CIN letter, the five-digit ABI code, a five-digit CAB (the branch), then the twelve-character account number. The ABI code is what the Banca d'Italia registers can name a holder for; the account part is known only to the bank.",
  docLink: "How the Italian registers answer",
  countryLink: "The Italian IBAN format, with the official example",
  partialRegisterCheck: (register) =>
    `The bank code against ${register}: the holder of every code it lists, without the weight of a register that settles a negative; the other codes against our composite map.`,
};

const fr: ItRegisterCopy = {
  eyebrow: "Registres de la Banca d'Italia",
  indexTitle: "Codes banque italiens (ABI) des registres de la Banca d'Italia",
  indexIntro: (n) =>
    `Les ${n} codes ABI que la Banca d'Italia tient en vigueur aujourd'hui : banques, établissements de paiement et établissements de monnaie électronique, chacun avec son siège légal en Italie et la réponse exacte de l'API IBANforge. Relus chaque semaine.`,
  inForceTitle: "Codes en vigueur",
  retiredHint:
    "Les codes que la Banca d'Italia a radiés ont aussi leur page, avec la date et le successeur légal : tapez-en un ci-dessus (03111, par exemple).",
  notExhaustiveTitle: "Ce qu'un code absent ne veut PAS dire",
  notExhaustive:
    "La Banca d'Italia liste les banques, les établissements de paiement et de monnaie électronique qu'elle inscrit, pas l'attribution de l'espace des codes ABI. Poste Italiane (07601), la Banca d'Italia elle-même (01000) et les succursales italiennes d'établissements de paiement européens émettent de vrais IBAN italiens hors de ces registres. Un code listé ici nomme donc son titulaire, et un code absent ne prouve rien : l'API répond authoritative: false pour l'Italie, et une absence n'est jamais une raison d'arrêter un paiement.",
  title: (code) => `Code banque italien ${code}`,
  metaTitle: (code, name, town) => `Code banque italien ${code} : ${name}, ${town}`,
  metaDescription: (code, name, town) =>
    `Code ABI ${code} dans les registres de la Banca d'Italia : ${name}, ${town}. Siège légal, LEI, structure de l'IBAN et réponse exacte de l'API IBANforge.`,
  retiredMetaTitle: (code, name) => `Code banque italien ${code} : ${name}, radié`,
  retiredMetaDescription: (code, name, date) =>
    `Le code ABI ${code} (${name}) a été radié des registres de la Banca d'Italia le ${date}. Son successeur légal, la structure de l'IBAN et la réponse exacte de l'API IBANforge.`,
  retiredTitle: "Un code que la Banca d'Italia a radié",
  retiredText: (date) =>
    `Le registre porte ce code pour la dernière fois le ${date}. L'API répond verified avec retired: true et ne sert aucun BIC, puisque personne ne tient ce code aujourd'hui. Ce n'est pas un refus : la durée pendant laquelle un ancien IBAN reste joignable après une fusion n'est pas publiée, demandez donc au bénéficiaire ses coordonnées à jour.`,
  successorText: (name, code) =>
    `Successeur légal par fusion ou incorporation : ${name} (${code}). Ce n'est pas forcément la banque qui tient le compte aujourd'hui : une banque peut céder des agences à une autre avant d'être absorbée.`,
  noSuccessorText:
    "Le registre ne nomme aucun successeur légal : l'établissement a été liquidé, ou son activité a été cédée plutôt que fusionnée.",
  successorLink: (code) => `La page du code ${code}`,
  facts: {
    code: "Code ABI",
    status: "Statut",
    inForce: "en vigueur",
    retired: "radié",
    holder: "Établissement",
    lastHolder: "Dernier titulaire",
    retiredOn: "Dernière inscription le",
    successor: "Successeur légal",
    street: "Siège légal en Italie",
    postCode: "Code postal",
    town: "Ville",
    lei: "LEI",
    none: "aucun",
  },
  structure:
    "Un IBAN italien, c'est IT, deux chiffres de contrôle, une lettre CIN, le code ABI à cinq chiffres, un CAB à cinq chiffres (l'agence), puis le numéro de compte à douze caractères. Le code ABI est ce dont les registres de la Banca d'Italia peuvent nommer le titulaire ; la partie compte n'est connue que de la banque.",
  docLink: "Comment répondent les registres italiens",
  countryLink: "Le format de l'IBAN italien, avec l'exemple officiel",
  partialRegisterCheck: (register) =>
    `Le code banque contre ${register} : le titulaire de chaque code qu'il liste, sans le poids d'un registre qui tranche une absence ; les autres codes contre notre carte composite.`,
};

const de: ItRegisterCopy = {
  eyebrow: "Register der Banca d'Italia",
  indexTitle: "Italienische Bankleitzahlen (ABI) in den Registern der Banca d'Italia",
  indexIntro: (n) =>
    `Die ${n} ABI-Codes, die die Banca d'Italia heute als gültig führt: Banken, Zahlungsinstitute und E-Geld-Institute, jeweils mit ihrem Sitz in Italien und der genauen Antwort der IBANforge-API. Jede Woche neu gelesen.`,
  inForceTitle: "Gültige Codes",
  retiredHint:
    "Auch die Codes, die die Banca d'Italia gelöscht hat, haben eine Seite, mit dem Datum und dem Rechtsnachfolger: oben einen eingeben (zum Beispiel 03111).",
  notExhaustiveTitle: "Was ein fehlender Code NICHT bedeutet",
  notExhaustive:
    "Die Banca d'Italia führt die Banken, Zahlungsinstitute und E-Geld-Institute, die sie einträgt, nicht die Vergabe des ABI-Coderaums. Poste Italiane (07601), die Banca d'Italia selbst (01000) und die italienischen Zweigniederlassungen europäischer Zahlungsinstitute geben echte italienische IBAN außerhalb dieser Register aus. Ein hier geführter Code nennt also seinen Inhaber, und ein fehlender Code beweist nichts: Die API antwortet für Italien authoritative: false, und ein Fehlen ist nie ein Grund, eine Zahlung zu stoppen.",
  title: (code) => `Italienische Bankleitzahl ${code}`,
  metaTitle: (code, name, town) => `Italienische Bankleitzahl ${code}: ${name}, ${town}`,
  metaDescription: (code, name, town) =>
    `ABI-Code ${code} in den Registern der Banca d'Italia: ${name}, ${town}. Sitz, LEI, IBAN-Aufbau und die genaue Antwort der IBANforge-API.`,
  retiredMetaTitle: (code, name) => `Italienische Bankleitzahl ${code}: ${name}, gelöscht`,
  retiredMetaDescription: (code, name, date) =>
    `Der ABI-Code ${code} (${name}) wurde am ${date} aus den Registern der Banca d'Italia gelöscht. Sein Rechtsnachfolger, der IBAN-Aufbau und die genaue Antwort der IBANforge-API.`,
  retiredTitle: "Ein Code, den die Banca d'Italia gelöscht hat",
  retiredText: (date) =>
    `Das Register führt diesen Code zuletzt am ${date}. Die API antwortet verified mit retired: true und liefert keinen BIC, da heute niemand diesen Code hält. Das ist keine Ablehnung: Wie lange eine alte IBAN nach einer Fusion erreichbar bleibt, wird nicht veröffentlicht; fragen Sie den Empfänger nach seinen aktuellen Angaben.`,
  successorText: (name, code) =>
    `Rechtsnachfolger durch Verschmelzung oder Eingliederung: ${name} (${code}). Das ist nicht unbedingt die Bank, die das Konto heute führt: Eine Bank kann vor ihrer Übernahme Filialen an eine andere Bank abgeben.`,
  noSuccessorText:
    "Das Register nennt keinen Rechtsnachfolger: Das Institut wurde abgewickelt, oder sein Geschäft wurde übertragen statt verschmolzen.",
  successorLink: (code) => `Die Seite des Codes ${code}`,
  facts: {
    code: "ABI-Code",
    status: "Status",
    inForce: "gültig",
    retired: "gelöscht",
    holder: "Institut",
    lastHolder: "Letzter Inhaber",
    retiredOn: "Zuletzt geführt am",
    successor: "Rechtsnachfolger",
    street: "Sitz in Italien",
    postCode: "Postleitzahl",
    town: "Ort",
    lei: "LEI",
    none: "keiner",
  },
  structure:
    "Eine italienische IBAN besteht aus IT, zwei Prüfziffern, einem CIN-Buchstaben, dem fünfstelligen ABI-Code, einem fünfstelligen CAB (der Filiale) und der zwölfstelligen Kontonummer. Für den ABI-Code können die Register der Banca d'Italia einen Inhaber nennen; den Kontoteil kennt nur die Bank.",
  docLink: "Wie die italienischen Register antworten",
  countryLink: "Das italienische IBAN-Format, mit dem offiziellen Beispiel",
  partialRegisterCheck: (register) =>
    `Die Bankleitzahl gegen ${register}: der Inhaber jedes dort geführten Codes, ohne das Gewicht eines Registers, das ein Fehlen entscheidet; die übrigen Codes gegen unsere zusammengesetzte Karte.`,
};

export const IT_REGISTER_COPY: Record<"en" | "fr" | "de", ItRegisterCopy> = { en, fr, de };

/** Les textes d'une langue du site ; l'anglais pour toute autre. */
export function itCopy(locale: string): ItRegisterCopy {
  return IT_REGISTER_COPY[locale as "en" | "fr" | "de"] ?? en;
}
