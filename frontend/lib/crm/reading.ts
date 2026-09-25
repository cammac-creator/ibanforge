import type { Message } from './types';

/**
 * Comment le CRM fait lire une correspondance : la langue d'origine dite par
 * une pastille, et le français par défaut.
 *
 * ## Pourquoi un seul module
 *
 * Le fil de conversation le faisait depuis juillet, avec sa propre table des
 * langues et sa propre règle. Les autres écrans (liste des contacts, journal du
 * courrier, brouillons, courrier à rattacher) ont grandi à côté, chacun à sa
 * façon : l'un montrait l'original sans rien dire, l'autre la traduction sans
 * dire que c'en était une, un troisième affichait le code « en » là où le fil
 * écrivait « anglais ». Claude-Alain a demandé le 24.09.2026 que ce soit la
 * même chose partout. La table et la règle vivent donc ici, une fois.
 */

/** Les langues détectées, en toutes lettres. Une langue absente s'affiche par son code. */
export const LANG_LABEL: Record<string, string> = {
  fr: 'français',
  en: 'anglais',
  de: 'allemand',
  it: 'italien',
  es: 'espagnol',
  pt: 'portugais',
  nl: 'néerlandais',
  zh: 'chinois',
  ru: 'russe',
  ar: 'arabe',
  ja: 'japonais',
  ko: 'coréen',
  pl: 'polonais',
  sv: 'suédois',
  da: 'danois',
  no: 'norvégien',
  fi: 'finnois',
  et: 'estonien',
  lv: 'letton',
  lt: 'lituanien',
  tr: 'turc',
  el: 'grec',
  he: 'hébreu',
  cs: 'tchèque',
  sk: 'slovaque',
  sl: 'slovène',
  hr: 'croate',
  sr: 'serbe',
  bg: 'bulgare',
  uk: 'ukrainien',
  ro: 'roumain',
  hu: 'hongrois',
  ca: 'catalan',
  ka: 'géorgien',
  lb: 'luxembourgeois',
  mt: 'maltais',
  is: 'islandais',
};

const VALID_LANG = /^[a-z]{2,3}$/;

/**
 * Un code de langue exploitable, ou null. Deux ou trois lettres minuscules, et
 * jamais « und » : c'est ce que le robot de traduction range quand il n'y avait
 * rien à lire (un mail fait de pièces jointes), pas une langue.
 */
export function usableLang(lang: string | null | undefined): string | null {
  return lang && VALID_LANG.test(lang) && lang !== 'und' ? lang : null;
}

/** Le nom de la langue en français, ou son code pour une langue que la table ne connaît pas. */
export function langName(lang: string): string {
  return LANG_LABEL[lang] ?? lang;
}

export interface Reading {
  /** La langue d'origine, null quand elle est inconnue. */
  lang: string | null;
  /** `text` est la traduction française, pas le texte d'origine. */
  translated: boolean;
  /**
   * Langue étrangère sans traduction (pas encore, ou le traducteur a échoué) :
   * `text` est alors l'original, et la pastille doit le dire.
   */
  untranslated: boolean;
  /** Le texte à lire. */
  text: string;
}

/**
 * La lecture d'un message dans une liste (une ligne d'aperçu) : la traduction
 * française quand on la tient, sinon l'extrait d'origine. Même règle que le fil.
 */
export function previewReading(m: Pick<Message, 'lang' | 'snippet_fr' | 'snippet'>): Reading {
  const lang = usableLang(m.lang);
  const fr = (m.snippet_fr ?? '').trim();
  const foreign = lang !== null && lang !== 'fr';
  const translated = foreign && fr.length > 0;
  return {
    lang,
    translated,
    untranslated: foreign && !translated,
    text: translated ? fr : (m.snippet ?? ''),
  };
}

/**
 * L'objet à lire : sa traduction française pour un message étranger qui en a
 * une, sinon l'objet d'origine. Pour l'affichage seulement : une réponse garde
 * l'objet d'origine, dans la langue du correspondant.
 */
export function subjectReading(m: Pick<Message, 'lang' | 'subject' | 'subject_fr'>): string {
  const lang = usableLang(m.lang);
  const fr = (m.subject_fr ?? '').trim();
  return lang !== null && lang !== 'fr' && fr ? fr : (m.subject ?? '').trim();
}
