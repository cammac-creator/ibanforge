/**
 * Titles and descriptions of the bank-code pages and of their indexes, in the
 * three languages of the site (29/09/2026).
 *
 * ## Why they changed
 *
 * These pages bring most of the search traffic, from people typing the words of
 * their question: "blz" and a code, "bic" with a bank and a town, "welche Bank".
 * They ranked well and were rarely clicked. The old title said "Bankleitzahl
 * 50110808: J.P. Morgan, Frankfurt am Main | IBANforge": neither "BLZ" nor the
 * BIC, the two things those searches name. So a title now starts with the code
 * as people type it and ends with the BIC when the register gives one, and a
 * description answers "which bank?" in its first sentence, then says which
 * register says so.
 *
 * ## The rules this file keeps
 *
 * - **Nothing added.** Every figure comes from the row the page already shows:
 *   code, name, short name, town, BIC, status, successor, register date. No
 *   title carries a fact the page does not print.
 * - **The register is named in every description.** For Italy (CC BY 4.0) and
 *   Slovakia (NBS terms), citing the source is a condition of reuse; the full
 *   credit stays at the foot of the page, untouched.
 * - **No BIC for Italy.** The Banca d'Italia publishes none; the BIC in the API's
 *   answer comes from our own curated map (`authoritative: false`), which a title
 *   would present as the register's word.
 * - **Lengths.** A title fits in `TITLE_MAX` characters as sent: the layout's
 *   " | IBANforge" template is bypassed with `absolute` on the code pages (Google
 *   prints the site name on its own line), and kept on the short index titles. A
 *   description fits in `DESCRIPTION_MAX`. When the full form is too long, the
 *   short name the register publishes replaces the long one, then the town goes,
 *   then the BIC; a description first drops its closing line and the register's
 *   date, then the longer wording of its question, never the register's name. Only
 *   as a last resort is the institution's name cut at a word, never the code.
 * - **No `Intl`.** Plain string assembly; dates stay written as the register
 *   writes them (YYYY-MM or YYYY-MM-DD).
 *
 * `lib/register-meta.test.ts` sweeps every row of the exported registers and
 * holds the lengths, the code and the BIC.
 */

import type { BlzRegister, IidIdentity, ItRegister, SkRegister } from './registers';

export const TITLE_MAX = 65;
export const DESCRIPTION_MAX = 155;

const SEP = ' · ';
const BRAND = ' | IBANforge';

type Lang = 'en' | 'fr' | 'de';

export interface PageMeta {
  /** Sent as `{ absolute }`: the layout's template would add twelve characters. */
  title: string;
  description: string;
}

function lang(locale: string): Lang {
  return locale === 'fr' || locale === 'de' ? locale : 'en';
}

type Part = string | null | undefined | false;

function joinParts(parts: Part[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '').join(SEP);
}

/** Distinct, non-empty names, the register's own form first. */
function namesOf(...names: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const n of names) {
    const v = (n ?? '').trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out.length ? out : [''];
}

function contains(haystack: string, needle: string): boolean {
  return needle.trim() !== '' && haystack.toLowerCase().includes(needle.trim().toLowerCase());
}

/** "Name, Town", unless the name already says the town. */
function withTown(name: string, town: string | null | undefined): string {
  return town && !contains(name, town) ? `${name}, ${town}` : name;
}

/**
 * Cut at a word so the result, ellipsis included, is at most `room` long.
 * Exported for the test: the cut must never leave a dangling comma.
 */
export function cutAtWord(text: string, room: number): string {
  if (text.length <= room) return text;
  if (room <= 1) return '…';
  const slice = text.slice(0, room - 1);
  const space = slice.lastIndexOf(' ');
  const base = space >= Math.floor(room / 2) ? slice.slice(0, space) : slice;
  return `${base.replace(/[\s,.;:(/-]+$/, '')}…`;
}

function firstFit(candidates: string[], max: number): string | null {
  for (const c of candidates) if (c.length <= max) return c;
  return null;
}

/** Last resort: the name is cut so that `build(name)` fits. Probed with a one-character name. */
function cutToFit(build: (name: string) => string, name: string, max: number): string {
  const overhead = build('\u0001').length - 1;
  return build(cutAtWord(name, Math.max(max - overhead, 1)));
}

/** The brand back on the title, only where it still fits. */
export function withBrand(title: string, max: number = TITLE_MAX): string {
  return title.length + BRAND.length <= max ? `${title}${BRAND}` : title;
}

/**
 * The standard ladder for a title: code, name (with the town), BIC. Each name is
 * tried in turn at each step, so the register's short name keeps the town and
 * the BIC where the long name cannot. No brand: see the header.
 */
function titleLadder(
  code: string,
  names: string[],
  town: string | null | undefined,
  tail: string | null,
): string {
  const candidates: string[] = [];
  for (const n of names) candidates.push(joinParts([code, withTown(n, town), tail]));
  for (const n of names) candidates.push(joinParts([code, n, tail]));
  for (const n of names) candidates.push(joinParts([code, withTown(n, town)]));
  for (const n of names) candidates.push(joinParts([code, n]));
  const shortest = names.reduce((a, b) => (b.length < a.length ? b : a));
  return firstFit(candidates, TITLE_MAX) ?? cutToFit((n) => joinParts([code, n, tail]), shortest, TITLE_MAX);
}

/**
 * The standard ladder for a description. `answers` are the same question from
 * the fullest wording to the shortest, `tails` what follows it from the richest
 * to the barest (which still names the register). Tried answer by answer, tail by
 * tail, name by name; the last resort cuts the name under the shortest of both.
 */
function descriptionLadder(answers: Array<(name: string) => string>, names: string[], tails: string[]): string {
  const candidates: string[] = [];
  for (const answer of answers) for (const tail of tails) for (const n of names) candidates.push(`${answer(n)}${tail}`);
  const lastAnswer = answers[answers.length - 1];
  const lastTail = tails[tails.length - 1] ?? '';
  const shortest = names.reduce((a, b) => (b.length < a.length ? b : a));
  return firstFit(candidates, DESCRIPTION_MAX) ?? cutToFit((n) => `${lastAnswer(n)}${lastTail}`, shortest, DESCRIPTION_MAX);
}

const bicPart = (bic: string | null | undefined): string | null => (bic ? `BIC ${bic}` : null);

// ─── Germany: the Bundesbank register ─────────────────────────────────────────

export function blzMeta(locale: string, r: BlzRegister): PageMeta {
  const l = lang(locale);
  const names = namesOf(r.name, r.short_name);
  const title = titleLadder(`BLZ ${r.blz}`, names, r.town, bicPart(r.bic));
  const bic = r.bic ? `, BIC ${r.bic}` : '';
  const place = (n: string, word: string) => (r.town && !contains(n, r.town) ? `${n} ${word} ${r.town}` : n);
  const copy = {
    en: {
      questions: [`Which bank is BLZ ${r.blz} (Bankleitzahl)?`, `Which bank is BLZ ${r.blz}?`],
      place: (n: string) => place(n, 'in'),
      retired: ` Marked for deletion${r.successor_blz ? `, successor BLZ ${r.successor_blz}` : ''}.`,
      sources: [` Per the Deutsche Bundesbank register as of ${r.as_of}.`, ` Per the Bundesbank (${r.as_of}).`, ' Per the Bundesbank.'],
      extra: ' IBAN structure and the API’s answer.',
    },
    fr: {
      questions: [`Quelle banque porte la BLZ ${r.blz} ?`, `BLZ ${r.blz} :`],
      place: (n: string) => place(n, 'à'),
      retired: ` Marquée pour suppression${r.successor_blz ? `, BLZ successeur ${r.successor_blz}` : ''}.`,
      sources: [` Selon le registre de la Deutsche Bundesbank au ${r.as_of}.`, ` Selon la Bundesbank (${r.as_of}).`, ' Selon la Bundesbank.'],
      extra: ' Structure de l’IBAN et réponse de l’API.',
    },
    de: {
      questions: [`Welche Bank hat die BLZ ${r.blz}?`, `BLZ ${r.blz}:`],
      place: (n: string) => place(n, 'in'),
      retired: ` Zur Löschung vorgemerkt${r.successor_blz ? `, Nachfolge-BLZ ${r.successor_blz}` : ''}.`,
      sources: [` Laut Bankleitzahlendatei der Deutschen Bundesbank, Stand ${r.as_of}.`, ` Laut Bundesbank, Stand ${r.as_of}.`, ' Laut Bundesbank.'],
      extra: ' Mit IBAN-Aufbau und API-Antwort.',
    },
  }[l];
  const status = r.retired ? copy.retired : '';
  const [long, ...shorter] = copy.sources;
  const description = descriptionLadder(
    copy.questions.map((q) => (n: string) => `${q} ${copy.place(n)}${bic}.${status}`),
    names,
    [`${long}${copy.extra}`, long, ...shorter],
  );
  return { title, description };
}

// ─── Switzerland: the SIX BankMaster ──────────────────────────────────────────

export function iidMeta(locale: string, iid: string, id: IidIdentity, validOn: string): PageMeta {
  const l = lang(locale);
  const names = namesOf(id.name);
  const bic = id.bic ? `, BIC ${id.bic}` : '';
  const place = (n: string, word: string) => (id.town && !contains(n, id.town) ? `${n} ${word} ${id.town}` : n);
  if (id.redirectedTo) {
    const merged = { en: 'merged into IID', fr: 'fusionné dans l’IID', de: 'zusammengeführt mit IID' }[l];
    const title = titleLadder(`IID ${iid}`, names.map((n) => `${merged} ${id.redirectedTo}${n ? `${SEP}${n}` : ''}`), id.town, bicPart(id.bic));
    const copy = {
      en: {
        answer: (n: string) => `Swiss clearing number ${iid} is redirected to IID ${id.redirectedTo} in the SIX BankMaster: ${place(n, 'in')}${bic}.`,
        tails: [' Payments to this number are routed to the successor.', ''],
      },
      fr: {
        answer: (n: string) => `Le numéro de clearing suisse ${iid} est redirigé vers l’IID ${id.redirectedTo} au SIX BankMaster : ${place(n, 'à')}${bic}.`,
        tails: [' Les paiements vers ce numéro vont au successeur.', ''],
      },
      de: {
        answer: (n: string) => `Die Schweizer Clearing-Nummer ${iid} wird im SIX BankMaster auf die IID ${id.redirectedTo} umgeleitet: ${place(n, 'in')}${bic}.`,
        tails: [' Zahlungen an diese Nummer gehen an die Nachfolgerin.', ''],
      },
    }[l];
    return { title, description: descriptionLadder([copy.answer], names, copy.tails) };
  }
  const title = titleLadder(`IID ${iid}`, names, id.town, bicPart(id.bic));
  const copy = {
    en: {
      questions: [`Which bank is IID ${iid} (Swiss clearing number)?`, `Which bank is IID ${iid}?`],
      place: (n: string) => place(n, 'in'),
      sources: [` Per the SIX BankMaster, valid on ${validOn}.`, ' Per the SIX BankMaster.'],
      extra: ' Payment services, QR-IID and IBAN structure.',
    },
    fr: {
      questions: [`Quelle banque porte l’IID ${iid} (numéro de clearing) ?`, `Quelle banque porte l’IID ${iid} ?`],
      place: (n: string) => place(n, 'à'),
      sources: [` Selon le SIX BankMaster, valable au ${validOn}.`, ' Selon le SIX BankMaster.'],
      extra: ' Services de paiement, QR-IID et structure de l’IBAN.',
    },
    de: {
      questions: [`Welche Bank hat die IID ${iid} (BC-Nummer)?`, `Welche Bank hat die IID ${iid}?`],
      place: (n: string) => place(n, 'in'),
      sources: [` Laut SIX BankMaster, gültig am ${validOn}.`, ' Laut SIX BankMaster.'],
      extra: ' Zahlungsdienste, QR-IID und IBAN-Aufbau.',
    },
  }[l];
  const [long, short] = copy.sources;
  return {
    title,
    description: descriptionLadder(
      copy.questions.map((q) => (n: string) => `${q} ${copy.place(n)}${bic}.`),
      names,
      [`${long}${copy.extra}`, long, short],
    ),
  };
}

// ─── Italy: the Banca d'Italia registers ──────────────────────────────────────

export function itMeta(locale: string, r: ItRegister): PageMeta {
  const l = lang(locale);
  const names = namesOf(r.name);
  const code = `ABI ${r.code}`;
  if (r.status === 'retired') {
    // The status stays in the title; only the name is cut when it must be.
    const struck = { en: 'struck off', fr: 'radié', de: 'gelöscht' }[l];
    const title = titleLadder(code, names, null, struck);
    const successor =
      r.successor_code && r.successor_name
        ? {
            en: ` Legal successor: ${r.successor_name} (${r.successor_code}).`,
            fr: ` Successeur légal : ${r.successor_name} (${r.successor_code}).`,
            de: ` Rechtsnachfolger: ${r.successor_name} (${r.successor_code}).`,
          }[l]
        : '';
    const copy = {
      en: {
        answer: (n: string) => `ABI code ${r.code} (${n}) was struck off the Banca d'Italia registers on ${r.retired_on}.`,
        extra: ' IBAN structure and the API’s answer.',
      },
      fr: {
        answer: (n: string) => `Le code ABI ${r.code} (${n}) a été radié des registres de la Banca d'Italia le ${r.retired_on}.`,
        extra: ' Structure de l’IBAN et réponse de l’API.',
      },
      de: {
        answer: (n: string) => `Der ABI-Code ${r.code} (${n}) wurde am ${r.retired_on} aus den Registern der Banca d'Italia gelöscht.`,
        extra: ' IBAN-Aufbau und API-Antwort.',
      },
    }[l];
    return { title, description: descriptionLadder([copy.answer], names, [`${successor}${copy.extra}`, successor, '']) };
  }
  const title = titleLadder(code, names, r.town, null);
  const place = (n: string) => withTown(n, r.town);
  const copy = {
    en: {
      answer: (n: string) => `Who holds ABI code ${r.code}? ${place(n)}.`,
      sources: [` Per the Banca d'Italia registers, edition ${r.as_of}.`, " Per the Banca d'Italia registers."],
      extra: ' Registered office, LEI and IBAN structure.',
    },
    fr: {
      answer: (n: string) => `Qui détient le code ABI ${r.code} ? ${place(n)}.`,
      sources: [` Selon les registres de la Banca d'Italia, édition du ${r.as_of}.`, " Selon les registres de la Banca d'Italia."],
      extra: ' Siège légal, LEI et structure de l’IBAN.',
    },
    de: {
      answer: (n: string) => `Wer hat den ABI-Code ${r.code}? ${place(n)}.`,
      sources: [` Laut den Registern der Banca d'Italia, Ausgabe ${r.as_of}.`, " Laut den Registern der Banca d'Italia."],
      extra: ' Sitz, LEI und IBAN-Aufbau.',
    },
  }[l];
  const [long, short] = copy.sources;
  return { title, description: descriptionLadder([copy.answer], names, [`${long}${copy.extra}`, long, short]) };
}

// ─── Slovakia: the NBS directory ──────────────────────────────────────────────

export function skMeta(locale: string, r: SkRegister): PageMeta {
  const l = lang(locale);
  const names = namesOf(r.name);
  const code = { en: `Slovak bank code ${r.code}`, fr: `Code banque slovaque ${r.code}`, de: `Slowakische Bankleitzahl ${r.code}` }[l];
  const title = titleLadder(code, names, null, bicPart(r.bic));
  const bic = r.bic ? `, BIC ${r.bic}` : '';
  const copy = {
    en: {
      answer: (n: string) => `Which bank is Slovak bank code ${r.code}? ${n}${bic}.`,
      sources: [` Per the Národná banka Slovenska directory of ${r.as_of}.`, ' Per the Národná banka Slovenska directory.'],
      extra: ' IBAN structure and the API’s answer.',
    },
    fr: {
      answer: (n: string) => `Quelle banque porte le code banque slovaque ${r.code} ? ${n}${bic}.`,
      sources: [` Selon le répertoire de la Národná banka Slovenska du ${r.as_of}.`, ' Selon le répertoire de la Národná banka Slovenska.'],
      extra: ' Structure de l’IBAN et réponse de l’API.',
    },
    de: {
      answer: (n: string) => `Welche Bank hat die slowakische Bankleitzahl ${r.code}? ${n}${bic}.`,
      sources: [` Laut Verzeichnis der Národná banka Slovenska, Stand ${r.as_of}.`, ' Laut Verzeichnis der Národná banka Slovenska.'],
      extra: ' IBAN-Aufbau und API-Antwort.',
    },
  }[l];
  const [long, short] = copy.sources;
  return { title, description: descriptionLadder([copy.answer], names, [`${long}${copy.extra}`, long, short]) };
}

// ─── Austria and Belgium: served live, titles and descriptions only ──────────

export interface LiveCodeIdentity {
  code: string;
  name: string;
  town: string | null;
  bic: string | null;
}

export function atMeta(locale: string, e: LiveCodeIdentity): PageMeta {
  const l = lang(locale);
  const names = namesOf(e.name);
  const code = { en: `BLZ ${e.code} (Austria)`, fr: `BLZ ${e.code} (Autriche)`, de: `BLZ ${e.code} (Österreich)` }[l];
  const title = titleLadder(code, names, e.town, bicPart(e.bic));
  const bic = e.bic ? `, BIC ${e.bic}` : '';
  const place = (n: string, word: string) => (e.town && !contains(n, e.town) ? `${n} ${word} ${e.town}` : n);
  const copy = {
    en: {
      answer: (n: string) => `Which bank is Austrian BLZ ${e.code}? ${place(n, 'in')}${bic}.`,
      source: ' Per the Oesterreichische Nationalbank directory.',
      extra: ' Seat address, LEI and IBAN structure.',
    },
    fr: {
      answer: (n: string) => `Quelle banque porte la BLZ autrichienne ${e.code} ? ${place(n, 'à')}${bic}.`,
      source: ' Selon le répertoire de l’Oesterreichische Nationalbank.',
      extra: ' Adresse du siège, LEI et structure de l’IBAN.',
    },
    de: {
      answer: (n: string) => `Welche Bank hat die österreichische BLZ ${e.code}? ${place(n, 'in')}${bic}.`,
      source: ' Laut Verzeichnis der Oesterreichischen Nationalbank.',
      extra: ' Sitzadresse, LEI und IBAN-Aufbau.',
    },
  }[l];
  return { title, description: descriptionLadder([copy.answer], names, [`${copy.source}${copy.extra}`, copy.source]) };
}

export function beMeta(locale: string, e: Omit<LiveCodeIdentity, 'town'>): PageMeta {
  const l = lang(locale);
  const names = namesOf(e.name);
  const code = { en: `Belgian bank code ${e.code}`, fr: `Code banque belge ${e.code}`, de: `Belgischer Bankcode ${e.code}` }[l];
  const title = titleLadder(code, names, null, bicPart(e.bic));
  const bic = e.bic ? `, BIC ${e.bic}` : '';
  const copy = {
    en: {
      answer: (n: string) => `Which bank is Belgian bank code ${e.code}? ${n}${bic}.`,
      source: ' Per the National Bank of Belgium list.',
      extra: ' IBAN structure and the API’s answer.',
    },
    fr: {
      answer: (n: string) => `Quelle banque porte le code banque belge ${e.code} ? ${n}${bic}.`,
      source: ' Selon la liste de la Banque nationale de Belgique.',
      extra: ' Structure de l’IBAN et réponse de l’API.',
    },
    de: {
      answer: (n: string) => `Welche Bank hat den belgischen Bankcode ${e.code}? ${n}${bic}.`,
      source: ' Laut Liste der Belgischen Nationalbank.',
      extra: ' IBAN-Aufbau und API-Antwort.',
    },
  }[l];
  return { title, description: descriptionLadder([copy.answer], names, [`${copy.source}${copy.extra}`, copy.source]) };
}

// ─── The indexes ──────────────────────────────────────────────────────────────

export type RegisterIndex = 'blz' | 'iid' | 'it' | 'sk' | 'at' | 'be';

/**
 * The index pages. `inForce` is the number of Italian codes listed in force,
 * read from the exported file by the page, as the index intro already does.
 */
export function registerIndexMeta(locale: string, index: RegisterIndex, inForce = 0): PageMeta {
  const l = lang(locale);
  const copy: Record<RegisterIndex, Record<Lang, PageMeta>> = {
    blz: {
      en: {
        title: 'BLZ lookup: German bank codes with bank and BIC',
        description:
          'Which bank is behind a German Bankleitzahl (BLZ)? Every BLZ of the Deutsche Bundesbank register, with its bank, town, BIC and status. Refreshed monthly.',
      },
      fr: {
        title: 'Recherche de BLZ : codes bancaires allemands, banque et BIC',
        description:
          'Quelle banque se cache derrière une BLZ allemande ? Chaque BLZ du registre de la Deutsche Bundesbank, avec sa banque, sa localité, son BIC et son statut.',
      },
      de: {
        title: 'BLZ-Suche: Bankleitzahl, Bank und BIC nachschlagen',
        description:
          'Welche Bank steckt hinter einer Bankleitzahl? Jede BLZ der Bankleitzahlendatei der Bundesbank mit Bank, Ort, BIC und Status. Monatlich aktualisiert.',
      },
    },
    iid: {
      en: {
        title: 'Swiss IID lookup: clearing number, bank and BIC',
        description:
          'Which bank is behind a Swiss IID (clearing number, BC-Nummer)? Every IID of the SIX BankMaster with its bank, seat, BIC, payment services and QR-IID.',
      },
      fr: {
        title: 'Recherche d’IID suisse : numéro de clearing, banque et BIC',
        description:
          'Quelle banque se cache derrière un IID suisse (numéro de clearing) ? Chaque IID du SIX BankMaster avec sa banque, son siège, son BIC et son QR-IID.',
      },
      de: {
        title: 'IID-Suche: Schweizer Clearing-Nummer, Bank und BIC',
        description:
          'Welche Bank steckt hinter einer IID (BC-Nummer)? Jede IID des SIX BankMaster mit Bank, Sitz, BIC, Zahlungsdiensten und QR-IID.',
      },
    },
    it: {
      en: {
        title: 'Italian ABI codes: institution, registered office and LEI',
        description: `Who holds an Italian ABI code? The ${inForce} codes in force in the Banca d'Italia registers, each with its institution, registered office and LEI.`,
      },
      fr: {
        title: 'Codes ABI italiens : établissement, siège légal et LEI',
        description: `Qui détient un code ABI italien ? Les ${inForce} codes en vigueur dans les registres de la Banca d'Italia, avec établissement, siège légal et LEI.`,
      },
      de: {
        title: 'Italienische ABI-Codes: Institut, Sitz und LEI',
        description: `Wer hat einen italienischen ABI-Code? Die ${inForce} gültigen Codes aus den Registern der Banca d'Italia, jeweils mit Institut, Sitz und LEI.`,
      },
    },
    sk: {
      en: {
        title: 'Slovak bank codes: bank and BIC (NBS directory)',
        description:
          'Which bank is behind a Slovak bank code? Every payment code of the Národná banka Slovenska directory, with the payment service provider and its BIC.',
      },
      fr: {
        title: 'Codes banque slovaques : banque et BIC (répertoire NBS)',
        description:
          'Quelle banque se cache derrière un code banque slovaque ? Chaque code du répertoire de la Národná banka Slovenska, avec son prestataire et son BIC.',
      },
      de: {
        title: 'Slowakische Bankleitzahlen: Bank und BIC (NBS)',
        description:
          'Welche Bank steckt hinter einer slowakischen Bankleitzahl? Jeder Code des Verzeichnisses der Národná banka Slovenska mit Zahlungsdienstleister und BIC.',
      },
    },
    at: {
      en: {
        title: 'Austrian BLZ lookup: bank, address and BIC',
        description:
          'Which bank is behind an Austrian Bankleitzahl (BLZ)? Look up any code of the Oesterreichische Nationalbank directory: bank, seat address, LEI and BIC.',
      },
      fr: {
        title: 'Recherche de BLZ autrichienne : banque, adresse et BIC',
        description:
          'Quelle banque se cache derrière une BLZ autrichienne ? Cherchez un code du répertoire de l’Oesterreichische Nationalbank : banque, siège, LEI et BIC.',
      },
      de: {
        title: 'Österreichische BLZ-Suche: Bank, Adresse und BIC',
        description:
          'Welche Bank steckt hinter einer österreichischen BLZ? Suchen Sie einen Code im Verzeichnis der Oesterreichischen Nationalbank: Bank, Sitz, LEI und BIC.',
      },
    },
    be: {
      en: {
        title: 'Belgian bank codes: bank and BIC (NBB list)',
        description:
          'Which bank is behind a Belgian bank code? Look up any identifier of the National Bank of Belgium list: the bank and its BIC.',
      },
      fr: {
        title: 'Codes banque belges : banque et BIC (liste BNB)',
        description:
          'Quelle banque se cache derrière un code banque belge ? Cherchez un identifiant de la liste de la Banque nationale de Belgique : la banque et son BIC.',
      },
      de: {
        title: 'Belgische Bankcodes: Bank und BIC (BNB-Liste)',
        description:
          'Welche Bank steckt hinter einem belgischen Bankcode? Suchen Sie eine Kennung der Liste der Belgischen Nationalbank: die Bank und ihren BIC.',
      },
    },
  };
  const m = copy[index][l];
  return { title: withBrand(m.title), description: m.description };
}
