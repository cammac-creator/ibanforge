/**
 * Les pages /at/{code}, /be/{code} et /sm/{code}, rendues à la demande depuis
 * l'API (étape du retrait, 25/09/2026).
 *
 * ## Pourquoi plus de fichier exporté
 *
 * Les registres autrichien (OeNB), belge (BNB) et saint-marinais (BCSM)
 * appartiennent à la famille sous conditions du dépôt de l'API
 * (src/lib/restricted-family.ts) : l'API les sert, une réponse par requête,
 * depuis une surcouche privée, et aucun fichier public ne peut plus en porter
 * les lignes. Les anciens exports (`data/registers/at-blz.json`, `be-bank.json`,
 * `sm-bank.json`) étaient justement une copie complète de ces registres dans ce
 * dépôt public : ils sont retirés.
 *
 * Une page de code reste la réponse de l'API pour ce code, comme avant, mais
 * lue au moment de la requête : un POST `/v1/iban/validate` côté serveur, sur un
 * IBAN synthétique construit ici (le même que l'export écrivait), avec la clé
 * serveur du bac à sable (`PLAYGROUND_API_KEY`, jamais envoyée au navigateur :
 * seules les variables `NEXT_PUBLIC_*` y parviennent). La réponse est mise en
 * cache un jour (`next.revalidate`) : un code lu une fois ne recoûte rien avant
 * le lendemain, et une relecture qui échoue garde la page déjà servie.
 *
 * ## Ce qu'une page ne peut plus faire
 *
 * Lister le registre entier, ou les autres codes d'un même établissement,
 * demanderait l'annuaire complet : c'est-à-dire le republier. Les pages d'index
 * gardent la recherche d'un code et ne listent plus rien ; les codes voisins et
 * les blocs belges ne sont plus affichés.
 *
 * ## Les trois issues d'une lecture
 *
 * - le registre nomme le titulaire du code : la page ;
 * - le registre dit que personne ne tient ce code (AT, BE : `not_allocated`),
 *   ou la liste saint-marinaise ne le porte pas : `null`, la page répond 404 ;
 * - tout le reste (API injoignable, clé refusée, registre non chargé en
 *   production, réponse inattendue) : une erreur, jamais une page fausse. Le
 *   cache de Next garde alors la dernière page réussie.
 */

export type LiveRegisterCountry = 'AT' | 'BE' | 'SM';

/** Le registre que chaque pays doit nommer dans `bank_code_check.register`. */
const REGISTER_PREFIX: Record<LiveRegisterCountry, string> = {
  AT: 'Oesterreichische Nationalbank',
  BE: 'Banque nationale de Belgique',
  SM: 'Central Bank of the Republic of San Marino',
};

/** Durée de cache d'une réponse de l'API pour une page de code, en secondes. */
export const LIVE_REVALIDATE_SECONDS = 86_400;

export interface LiveRegisterEntry {
  country: LiveRegisterCountry;
  code: string;
  name: string;
  bic: string | null;
  street: string | null;
  post_code: string | null;
  town: string | null;
  lei: string | null;
  /** Le mois auquel l'API date le verdict du registre. */
  as_of: string | null;
  /** Le registre, tel que l'API le nomme dans `bank_code_check.register`. */
  register: string;
  /** Le crédit que l'API attache au BIC lu dans le registre, s'il en donne un. */
  source: string | null;
  example_iban: string;
  /** La réponse de l'API, réduite aux champs qu'un lecteur peut utiliser. */
  api: Record<string, unknown>;
}

/** Un registre que l'API n'a pas pu lire, ou une réponse qu'elle ne devrait pas donner. */
export class RegisterPageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegisterPageUnavailableError';
  }
}

/**
 * Le code tel que le registre l'écrit, ou null s'il n'en a pas la forme.
 * Autriche : cinq chiffres, sans complément (19043 n'est pas 019043). Belgique :
 * trois chiffres, zéros de tête compris. Saint-Marin : cinq chiffres, complétés
 * comme la BCSM les imprime.
 */
export function normaliseLiveCode(cc: LiveRegisterCountry, raw: string): string | null {
  if (cc === 'AT') return /^\d{5}$/.test(raw) ? raw : null;
  if (cc === 'BE') return /^\d{3}$/.test(raw) ? raw : null;
  return /^\d{1,5}$/.test(raw) ? raw.padStart(5, '0') : null;
}

/** ISO 13616 : les deux chiffres de contrôle d'un pays et d'un BBAN (mod 97 par tranches). */
export function ibanCheckDigits(country: string, bban: string): string {
  const rearranged = `${bban}${country}00`;
  let expanded = '';
  for (const ch of rearranged) expanded += /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
  let rem = 0;
  for (let i = 0; i < expanded.length; i += 7) rem = Number(`${rem}${expanded.slice(i, i + 7)}`) % 97;
  return String(98 - rem).padStart(2, '0');
}

/** Valeurs des positions impaires du CIN italien et saint-marinais (norme de la Banca d'Italia). */
const CIN_ODD_VALUES = [
  1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23,
];

/**
 * La lettre de contrôle (CIN) d'un BBAN saint-marinais, calculée sur l'ABI, le
 * CAB et le compte comme le fait l'API (src/lib/national-check/it-cin.ts) : un
 * exemple dont la lettre serait fausse répondrait `fail` sur nos propres pages.
 */
export function computeCin(abi: string, cab: string, account: string): string {
  const chars = abi + cab + account;
  let sum = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars.charCodeAt(i);
    const code = c >= 48 && c <= 57 ? c - 48 : c - 65;
    sum += i % 2 === 0 ? CIN_ODD_VALUES[code]! : code;
  }
  return String.fromCharCode(65 + (sum % 26));
}

/**
 * L'IBAN synthétique d'une page : le code à sa place, un compte fictif. Le même
 * que l'ancien export (scripts/export-register-pages.ts du dépôt de l'API).
 */
export function liveExampleIban(cc: LiveRegisterCountry, code: string): string {
  let bban: string;
  if (cc === 'AT') bban = `${code}00000000001`;
  else if (cc === 'BE') {
    const account = '0000001';
    const national = String(Number(`${code}${account}`) % 97 || 97).padStart(2, '0');
    bban = `${code}${account}${national}`;
  } else {
    bban = `${computeCin(code, '09800', '000000270100')}${code}09800000000270100`;
  }
  return `${cc}${ibanCheckDigits(cc, bban)}${bban}`;
}

type Json = Record<string, unknown>;

function pick(obj: unknown, keys: string[]): Json | null {
  if (!obj || typeof obj !== 'object') return null;
  const out: Json = {};
  for (const k of keys) if ((obj as Json)[k] !== undefined) out[k] = (obj as Json)[k];
  return out;
}

/**
 * Le bloc qu'imprime la page : les mêmes champs que les pages des registres
 * publics (de-blz.json, sk-bank.json…), et pour SEPA les seuls faits du pays.
 */
export function liveApiBlock(answer: Json): Json {
  return {
    valid: answer.valid,
    bic: pick(answer.bic, [
      'code',
      'bic8',
      'bank_name',
      'city',
      'source',
      'as_of',
      'basis',
      'authoritative',
      'lei',
    ]),
    bank_code_check: answer.bank_code_check ?? null,
    sepa: pick(answer.sepa, ['member', 'vop_required']),
    issuer: pick(answer.issuer, ['type', 'name', 'classification']),
    risk_indicators: pick(answer.risk_indicators, [
      'country_risk',
      'sepa_reachable',
      'vop_coverage',
      'test_bic',
    ]),
  };
}

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * La page d'un code, depuis la réponse de l'API. `null` : ce code n'a pas de
 * page (personne ne le tient, ou la liste saint-marinaise ne le porte pas).
 * Lève RegisterPageUnavailableError quand la réponse ne permet pas de trancher.
 */
export function interpretLiveAnswer(
  cc: LiveRegisterCountry,
  code: string,
  exampleIban: string,
  answer: Json,
): LiveRegisterEntry | null {
  const check = answer.bank_code_check as Json | null | undefined;
  if (answer.valid !== true || !check)
    throw new RegisterPageUnavailableError(`${cc} ${code}: no bank-code verdict in the answer`);
  const register = text(check.register);
  const fromRegister = !!register && register.startsWith(REGISTER_PREFIX[cc]);
  if (check.status === 'verified' && check.match === 'register' && fromRegister) {
    const institution = (check.institution ?? {}) as Json;
    const name = text(institution.name);
    if (!name) throw new RegisterPageUnavailableError(`${cc} ${code}: the register named nobody`);
    const bic = (answer.bic ?? null) as Json | null;
    const bicFromRegister = bic?.basis === 'national_register' ? text(bic.code) : null;
    return {
      country: cc,
      code,
      name,
      bic: bicFromRegister,
      street: text(institution.street),
      post_code: text(institution.post_code),
      town: text(institution.town),
      lei: text(institution.lei),
      as_of: text(check.as_of),
      register,
      source: bicFromRegister ? text(bic?.source) : null,
      example_iban: exampleIban,
      api: liveApiBlock(answer),
    };
  }
  // Personne ne tient ce code : le registre autrichien ou belge le dit.
  if (cc !== 'SM' && check.status === 'not_in_register' && check.reason === 'not_allocated')
    return null;
  // Saint-Marin : la liste a été lue et ne porte pas ce code (elle ne publie pas
  // l'attribution de l'espace ABI : ce n'est pas un refus, seulement pas de page).
  if (cc === 'SM' && check.reason === 'absent_from_reference_data') return null;
  if (cc === 'SM' && check.status === 'verified' && !fromRegister) return null;
  throw new RegisterPageUnavailableError(
    `${cc} ${code}: the register could not be read (${String(check.status)}, ${String(check.reason ?? '')})`,
  );
}

/**
 * Lit la page d'un code à l'API. Côté serveur seulement : la clé du bac à sable
 * n'existe que dans l'environnement du serveur.
 */
export async function fetchLiveRegisterEntry(
  cc: LiveRegisterCountry,
  rawCode: string,
): Promise<LiveRegisterEntry | null> {
  const code = normaliseLiveCode(cc, rawCode);
  if (!code) return null;
  const iban = liveExampleIban(cc, code);
  const apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  const key = process.env.PLAYGROUND_API_KEY || '';
  const res = await fetch(`${apiUrl}/v1/iban/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ iban }),
    next: { revalidate: LIVE_REVALIDATE_SECONDS },
  });
  if (!res.ok) throw new RegisterPageUnavailableError(`${cc} ${code}: the API answered ${res.status}`);
  return interpretLiveAnswer(cc, code, iban, (await res.json()) as Json);
}
