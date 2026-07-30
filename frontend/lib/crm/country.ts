/**
 * Turn the country field into something that can be counted.
 *
 * ## What the field actually holds
 *
 * Measured on 27/07/2026: about half as many distinct labels as there were
 * rows, more than half of those labels appearing exactly once. The same country
 * written three ways ("Suisse",
 * "Switzerland", "Switzerland / EU"), ISO codes mixed with names in two
 * languages ("DE" beside "Allemagne" beside "Germany"), and whole sentences
 * where a country was expected:
 *
 *   "Unknown (US-oriented stack: Stripe/Mercury/QuickBooks/Xero)"
 *   "United States (global; covered in Swiss fintech press, EU corridors)"
 *
 * It was filled in free text by the sourcing and never normalised, so it could
 * not be filtered, grouped or counted. It was decoration.
 *
 * ## Normalising on read rather than migrating the table
 *
 * The rows keep their text. Nothing is rewritten, no migration runs, and the
 * nuance a human wrote ("Switzerland / Austria", "covered in Swiss fintech
 * press") is not destroyed to make a chart tidier. What this module adds is a
 * second, derived value beside it. If the mapping is ever wrong, the fix is a
 * deploy rather than a data recovery.
 *
 * ## Where the names come from
 *
 * Not from a hardcoded list of forty entries, which would rot. Every ISO 3166
 * alpha-2 code is enumerated once at module load and asked for its name in
 * French and in English through `Intl.DisplayNames`, the same API the rest of
 * this codebase uses for country names. A code is real when the runtime gives
 * back something other than the code itself.
 */

/** Lowercase, strip accents and punctuation, collapse spaces. */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Codes the runtime names but that are not a country: supranational bodies and
 * the "unknown" placeholders. Without this deny-list, "EU (Czech Republic /
 * Canada entities)" resolves to EU and appears in a geography breakdown as if
 * it were a place, which is exactly the kind of tidy-looking wrong answer this
 * module exists to prevent.
 */
const NOT_A_COUNTRY = new Set([
  'EU', 'EZ', 'UN', 'ZZ', 'QO', 'XA', 'XB',
  // Deprecated codes the runtime still names, and whose name collides with a
  // live country's. FX ("France métropolitaine") comes back as plain "France"
  // in English: measured on the real data, rows saying "France" were filed
  // under FX rather than FR before this line existed.
  'FX', 'AN', 'CS', 'SU', 'YU', 'ZR', 'TP', 'BU', 'DD', 'NT', 'QU',
]);

/**
 * Alias codes the runtime resolves but that must collapse onto their canonical
 * country. ICU gives 'UK' the name "Royaume-Uni", so without this both the
 * code and the name would land on 'UK' while a row saying 'GB' landed on 'GB',
 * splitting one country in two: the very defect being fixed.
 */
const CANONICAL: Record<string, string> = { UK: 'GB', EL: 'GR' };

/** name (folded) -> ISO 3166-1 alpha-2, built once from the runtime's own data. */
const BY_NAME: Map<string, string> = (() => {
  const map = new Map<string, string>();
  const namers = ['fr', 'en'].map((l) => new Intl.DisplayNames([l], { type: 'region' }));
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const raw = String.fromCharCode(a, b);
      if (NOT_A_COUNTRY.has(raw)) continue;
      const code = CANONICAL[raw] ?? raw;
      for (const namer of namers) {
        let name: string | undefined;
        try {
          name = namer.of(raw);
        } catch {
          continue; // not a well-formed region subtag
        }
        // A code with no name comes back as itself. That is the only signal the
        // API gives that the subtag is unassigned.
        if (!name || name === raw) continue;
        // First writer wins, for names and for codes alike. Codes are walked in
        // alphabetical order, so a live country is always reached before the
        // deprecated or alias code that shares its name, and an alias can only
        // ever add its own spelling rather than steal an existing one. The
        // earlier version of this guard let any non-alias code overwrite, which
        // is how FX took France.
        if (!map.has(fold(name))) map.set(fold(name), code);
        if (!map.has(fold(raw))) map.set(fold(raw), code);
      }
    }
  }
  // Everyday forms no display name covers. Some are abbreviations; others are
  // how people actually write a country whose official name the runtime gives
  // in full ("R.A.S. chinoise de Hong Kong" for HK, "Tchéquie" for CZ).
  const extra: Record<string, string> = {
    usa: 'US',
    us: 'US',
    uk: 'GB',
    'grande bretagne': 'GB',
    angleterre: 'GB',
    'etats unis': 'US',
    'etats unis d amerique': 'US',
    uae: 'AE',
    'hong kong': 'HK',
    macao: 'MO',
    macau: 'MO',
    'coree du sud': 'KR',
    'south korea': 'KR',
    'republique tcheque': 'CZ',
    'czech republic': 'CZ',
    tchequie: 'CZ',
  };
  for (const [k, v] of Object.entries(extra)) if (!map.has(k)) map.set(k, v);
  return map;
})();

/** What a row's country resolves to. */
export interface ResolvedCountry {
  /** ISO 3166-1 alpha-2, or null when the text names no country. */
  code: string | null;
  /** What to print: the country's French name, or an honest bucket label. */
  label: string;
  /** The text as stored, always, so nothing a human wrote is lost. */
  raw: string | null;
}

const FR_NAMES = new Intl.DisplayNames(['fr'], { type: 'region' });

/** Bucket for a value that names no single country. Shown, never dropped. */
export const UNKNOWN_LABEL = 'Pays non renseigné';

/**
 * Resolve one stored value.
 *
 * A value carrying several countries ("Switzerland / Austria", "Hong Kong /
 * Singapore") resolves to the FIRST one named, and a value carrying a country
 * plus a comment ("USA (Texas)") to the country. Both are lossy on purpose:
 * the raw text is kept beside the code, and a row that lands in one bucket
 * beats a row that lands in none. What must never happen is silent
 * disappearance, which is why nothing here returns undefined.
 */
export function resolveCountry(raw: string | null | undefined): ResolvedCountry {
  const text = (raw ?? '').trim();
  if (!text) return { code: null, label: UNKNOWN_LABEL, raw: raw ?? null };

  // Try the whole string first: "Republique tcheque" must not be cut at a
  // space. Then progressively narrower leading segments, so "Switzerland / EU"
  // finds Switzerland and "Unknown (built on ...)" finds nothing at all rather
  // than matching a word buried in the comment.
  const candidates = [text, text.split('/')[0], text.split('(')[0], text.split(',')[0], text.split(';')[0]];
  for (const c of candidates) {
    const code = BY_NAME.get(fold(c));
    if (code) return { code, label: nameOf(code), raw: text };
  }
  return { code: null, label: UNKNOWN_LABEL, raw: text };
}

/** French name of a code, falling back to the code when the runtime has none. */
export function nameOf(code: string): string {
  try {
    return FR_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
}
