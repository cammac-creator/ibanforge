import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Suisse et Liechtenstein : le NPA et la localité d'une adresse vont-ils
 * ensemble ? (décision de Claude-Alain du 29.10.2026, 15 h 06, « localites = Oui »)
 *
 * ## D'où vient la table
 *
 * Du répertoire officiel des localités avec NPA et périmètre de l'Office fédéral
 * de topographie swisstopo (ordonnance sur les noms géographiques, art. 24 ;
 * collection STAC `ch.swisstopo-vd.ortschaftenverzeichnis_plz`, mise à jour
 * mensuelle). scripts/seed-ch-localities.ts le télécharge et n'en garde que six
 * colonnes : NPA, chiffre additionnel, localité, commune, canton, langue. Le
 * fichier data/ch-localities.json porte la version du jeu (la date de
 * l'élément STAC), le jour de lecture et la phrase des conditions.
 *
 * ## Conditions de la source (cas 1 de la règle du 28.10.2026)
 *
 * Lues le 29.10.2026 sur
 * https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices :
 * « The free geodata and geoservices of swisstopo may be used, distributed and
 * made accessible. Furthermore, they may be enriched and processed and also used
 * commercially. A reference to the source is mandatory. » La mention
 * « ©swisstopo » voyage avec chaque réponse construite sur la table (`source`).
 *
 * ## Ce que la table ne dit pas
 *
 * Elle décrit le territoire : chaque NPA y figure avec son périmètre. Un NPA
 * sans périmètre propre (case postale, grande entreprise : 1211 Genève, 3003
 * Bern, 2501 Biel, mesurés absents le 29.10.2026) n'y est pas, ni un NPA suisse
 * employé hors du territoire (8238 Büsingen, commune allemande). D'où l'état
 * `not_verifiable` quand la localité écrite figure sous d'autres NPA de la même
 * zone postale (mêmes deux premiers chiffres) : rien n'est affirmé, et aucun
 * avertissement ne part. Un NPA absent n'est jamais dit « inexistant ».
 *
 * Elle ne connaît pas les rues. Elle ne dit rien du titulaire d'un compte.
 *
 * ## Avertissement, jamais erreur
 *
 * Une localité réelle écrite autrement que dans le répertoire serait signalée à
 * tort : la comparaison tolère accents, majuscules, « St. », « Sankt » et
 * « Saint », suffixe de canton, numéro de tri (« Lausanne 25 »), parenthèses et
 * chaque moitié d'un nom bilingue (« Biel/Bienne »), plus les exonymes des
 * grandes villes ci-dessous. Ce qui reste est un avertissement : il ne fait
 * jamais tomber `conforms` (check_postal_address), ni `valid` ni
 * `ready_for_2026_11_14` (check_swiss_qr_bill), et une ligne d'audit passe au
 * plus en « à vérifier ».
 *
 * ## Où le fichier est lu
 *
 * En développement et en CI : data/ch-localities.json. En production, le volume
 * Railway recouvre data/ : le Dockerfile copie le fichier dans reference/ et
 * `CH_LOCALITIES_PATH` le désigne. Un fichier absent ou illisible ne lève
 * jamais d'erreur : le bloc répond `directory_unavailable`, sans avertissement.
 */

/** Une ligne du fichier : NPA, chiffre additionnel, localité, commune, canton (vide au Liechtenstein), langue. */
export type ChLocalityRow = [
  postcode: string,
  additional_digit: string,
  locality: string,
  municipality: string,
  canton: string,
  language: string,
];

export const CH_LOCALITY_COLUMNS = [
  'postcode',
  'additional_digit',
  'locality',
  'municipality',
  'canton',
  'language',
] as const;

export interface ChLocalitiesTable {
  /** Le jeu, nommé comme swisstopo le nomme. */
  source: string;
  /** La mention que swisstopo exige. */
  attribution: string;
  /** Identifiant de la collection STAC. */
  collection: string;
  item_url: string;
  file_url: string;
  /** Version du jeu : la date de l'élément STAC (AAAA-MM-JJ). C'est le `as_of` servi. */
  version: string;
  /** Horodatage `updated` de l'élément STAC. */
  updated: string;
  etag: string | null;
  sha256: string;
  /** Le jour où le script a lu le fichier (AAAA-MM-JJ). */
  fetched_on: string;
  /** Les conditions, mot pour mot, et où et quand elles ont été lues. */
  terms: string;
  terms_url: string;
  terms_read_on: string;
  columns: readonly string[];
  rows: ChLocalityRow[];
}

export const CH_LOCALITIES_ATTRIBUTION = '©swisstopo';
export const CH_LOCALITIES_COLLECTION = 'ch.swisstopo-vd.ortschaftenverzeichnis_plz';

/** En dessous, la table est tronquée : le fichier du 01.10.2026 compte 5 716 lignes et 3 190 NPA. */
export const CH_LOCALITIES_MIN_ROWS = 5000;

/** Les 26 cantons ; le Liechtenstein a un canton vide dans le répertoire. */
export const CH_CANTONS: ReadonlySet<string> = new Set([
  'AG',
  'AI',
  'AR',
  'BE',
  'BL',
  'BS',
  'FR',
  'GE',
  'GL',
  'GR',
  'JU',
  'LU',
  'NE',
  'NW',
  'OW',
  'SG',
  'SH',
  'SO',
  'SZ',
  'TG',
  'TI',
  'UR',
  'VD',
  'VS',
  'ZG',
  'ZH',
]);

const LANGUAGES: ReadonlySet<string> = new Set(['de', 'fr', 'it', 'rm', 'multiple']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Vrai quand l'objet a la forme d'une table utilisable. */
export function isChLocalitiesTable(value: unknown): value is ChLocalitiesTable {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Partial<ChLocalitiesTable>;
  for (const k of ['source', 'attribution', 'collection', 'file_url', 'terms', 'sha256'] as const) {
    if (typeof t[k] !== 'string' || !t[k]) return false;
  }
  if (t.attribution !== CH_LOCALITIES_ATTRIBUTION) return false;
  if (typeof t.version !== 'string' || !DATE.test(t.version)) return false;
  if (typeof t.fetched_on !== 'string' || !DATE.test(t.fetched_on)) return false;
  if (!Array.isArray(t.rows) || t.rows.length < CH_LOCALITIES_MIN_ROWS) return false;
  return t.rows.every(
    (r) =>
      Array.isArray(r) &&
      r.length === CH_LOCALITY_COLUMNS.length &&
      r.every((v) => typeof v === 'string') &&
      /^\d{4}$/.test(r[0]) &&
      /^\d{2}$/.test(r[1]) &&
      r[2] !== '' &&
      r[3] !== '' &&
      (r[4] === '' || CH_CANTONS.has(r[4])) &&
      LANGUAGES.has(r[5]),
  );
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function tablePath(): string {
  // src/lib/ et dist/lib/ sont tous deux à deux niveaux de la racine.
  return process.env.CH_LOCALITIES_PATH ?? resolve(__dirname, '../../data/ch-localities.json');
}

// ---------------------------------------------------------------------------
// Exonymes des grandes villes
// ---------------------------------------------------------------------------

/**
 * Les noms d'usage d'une grande ville dans une autre langue que celle du
 * répertoire (« Genf », « Berne », « Bâle »). Le répertoire ne connaît que le
 * nom officiel ; sans cette liste, « 1204 Genf » serait signalé à tort.
 *
 * Provenance : libellés allemand, français, italien et anglais de Wikidata
 * (domaine public, CC0), lus le 29.10.2026 par numéro de commune de l'OFS
 * (propriété P771) ; seuls ceux qui diffèrent du nom officiel après
 * normalisation sont gardés. Ils servent UNIQUEMENT à ne pas signaler une
 * adresse juste : ils ne sont jamais servis comme nom officiel.
 */
export const CH_TOWN_EXONYMS: Readonly<Record<string, readonly string[]>> = {
  Genève: ['Genf', 'Ginevra', 'Geneva'], // 6621
  Bern: ['Berne', 'Berna'], // 351
  Basel: ['Bâle', 'Basilea'], // 2701
  Zürich: ['Zurigo'], // 261 ; « Zurich » passe par les accents
  Luzern: ['Lucerne', 'Lucerna'], // 1061
  Fribourg: ['Freiburg im Üechtland', 'Friburgo'], // 2196 ; « Freiburg » par le préfixe
  Neuchâtel: ['Neuenburg'], // 6458
  Sion: ['Sitten'], // 6266
  Sierre: ['Siders'], // 6248
  Solothurn: ['Soleure', 'Soletta'], // 2601
  Schaffhausen: ['Schaffhouse', 'Sciaffusa'], // 2939
  Chur: ['Coire', 'Coira'], // 3901
  'St. Gallen': ['Saint-Gall', 'San Gallo'], // 3203
  Lausanne: ['Losanna'], // 5586
  Thun: ['Thoune'], // 942
  Murten: ['Morat'], // 2275
  Delémont: ['Delsberg'], // 6711
  Porrentruy: ['Pruntrut'], // 6800
  Winterthur: ['Winterthour'], // 230
  Bellinzona: ['Bellinzone'], // 5002
  Visp: ['Viège'], // 6297
  'Brig-Glis': ['Brigue-Glis', 'Briga-Glis'], // 6002
  Leuk: ['Loèche'], // 6110
  Zug: ['Zoug', 'Zugo'], // 1711
  Schwyz: ['Schwytz', 'Svitto'], // 1372
  Glarus: ['Glaris', 'Glarona'], // 1632
  Appenzell: ['Appenzello'], // 3101
};

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * La clé de comparaison d'un nom de localité : sans accents ni majuscules,
 * ponctuation en espaces, « Sankt » et « Saint » en « st », « Sainte » en
 * « ste », et « ae », « oe », « ue » ramenés à une lettre (« Zuerich »).
 */
export function townKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w === 'sankt' || w === 'saint' ? 'st' : w === 'sainte' ? 'ste' : w))
    .join(' ')
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u');
}

/**
 * Toutes les clés sous lesquelles un nom peut s'écrire : le nom entier, chaque
 * moitié d'un nom bilingue (« Biel/Bienne »), sans la parenthèse finale
 * (« Roches (BE) », « Eison (St-Martin) »), sans le numéro de tri (« Lausanne
 * 25 », « Zürich 1 ») et sans le suffixe de canton (« Wisen SO »).
 */
export function nameVariants(raw: string): string[] {
  const out = new Set<string>();
  const visit = (value: string): void => {
    const s = value.trim();
    if (!s) return;
    out.add(townKey(s));
    if (s.includes('/')) for (const part of s.split('/')) visit(part);
    const withoutParen = s.replace(/\s*\([^)]*\)\s*$/, '');
    if (withoutParen !== s) visit(withoutParen);
    const withoutNumber = s.replace(/\s+\d+$/, '');
    if (withoutNumber !== s) visit(withoutNumber);
    const canton = /^(.*\S)\s+([A-Z]{2})$/.exec(s);
    if (canton && CH_CANTONS.has(canton[2]!)) visit(canton[1]!);
  };
  visit(raw);
  out.delete('');
  return [...out];
}

/**
 * Vrai quand l'une des clés écrites désigne l'un des noms admis : égalité, ou
 * un quartier ajouté au nom (« Zürich-Oerlikon » pour « Zürich »), ou le début
 * d'un nom plus long (« Le Mont » pour « Le Mont-sur-Lausanne », « Freiburg »
 * pour « Freiburg im Üechtland »), à partir de trois lettres.
 */
function namesMatch(written: readonly string[], accepted: ReadonlySet<string>): boolean {
  for (const w of written) {
    if (accepted.has(w)) return true;
    for (const a of accepted) {
      if (w.startsWith(`${a} `)) return true;
      if (w.length >= 3 && a.startsWith(`${w} `)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// La table et ses index
// ---------------------------------------------------------------------------

type Country = 'CH' | 'LI';

interface Indexed {
  table: ChLocalitiesTable;
  /** NPA → lignes, par pays. */
  byPostcode: Map<string, ChLocalityRow[]>;
  /** Pays → clé de nom → NPA où ce nom figure (localité, commune ou exonyme). */
  byName: Record<Country, Map<string, Set<string>>>;
}

const countryOf = (row: ChLocalityRow): Country => (row[4] === '' ? 'LI' : 'CH');

/** Les clés admises pour une ligne : localité, commune et leurs exonymes. */
function rowKeys(row: ChLocalityRow): string[] {
  const names = [row[2], row[3]];
  for (const n of [row[2], row[3]]) names.push(...(CH_TOWN_EXONYMS[n] ?? []));
  return names.flatMap(nameVariants);
}

function buildIndex(table: ChLocalitiesTable): Indexed {
  const byPostcode = new Map<string, ChLocalityRow[]>();
  const byName: Indexed['byName'] = { CH: new Map(), LI: new Map() };
  for (const row of table.rows) {
    const list = byPostcode.get(row[0]);
    if (list) list.push(row);
    else byPostcode.set(row[0], [row]);
    const names = byName[countryOf(row)];
    for (const key of rowKeys(row)) {
      const set = names.get(key);
      if (set) set.add(row[0]);
      else names.set(key, new Set([row[0]]));
    }
  }
  return { table, byPostcode, byName };
}

let indexed: Indexed | null = null;
let loadAttempted = false;

/** La table, lue une fois par processus ; `null` si le fichier manque ou ne tient pas. */
export function loadChLocalities(): ChLocalitiesTable | null {
  return loadIndexed()?.table ?? null;
}

function loadIndexed(): Indexed | null {
  if (loadAttempted) return indexed;
  loadAttempted = true;
  try {
    const parsed: unknown = JSON.parse(readFileSync(tablePath(), 'utf8'));
    indexed = isChLocalitiesTable(parsed) ? buildIndex(parsed) : null;
  } catch {
    indexed = null;
  }
  return indexed;
}

/** Oublie la table lue (tests, ou après un rafraîchissement). */
export function resetChLocalities(): void {
  indexed = null;
  loadAttempted = false;
}

// ---------------------------------------------------------------------------
// Le contrôle
// ---------------------------------------------------------------------------

/**
 * - `match` : le NPA figure au répertoire pour le pays de l'adresse, et la
 *   localité écrite est l'une de ses localités ou communes ;
 * - `town_mismatch` : le NPA y figure, la localité écrite n'est aucune d'elles ;
 * - `other_country` : le NPA n'y figure que pour l'autre pays du répertoire
 *   (9490 Vaduz écrit avec `CH`) ;
 * - `postcode_not_listed` : le NPA n'y figure pas, et la localité écrite n'y
 *   figure pas dans la même zone postale ;
 * - `not_verifiable` : le NPA n'y figure pas, mais la localité écrite figure
 *   sous d'autres NPA de la même zone (2501 Biel, 1211 Genève, 3003 Bern) :
 *   probablement un NPA de case postale ou d'entreprise, que le répertoire ne
 *   décrit pas ; rien n'est affirmé ;
 * - `directory_unavailable` : la table n'a pas pu être lue sur ce serveur.
 *
 * Les trois premiers états après `match` donnent un avertissement ; les autres
 * aucun.
 */
export type PostcodeLocalityStatus =
  | 'match'
  | 'town_mismatch'
  | 'other_country'
  | 'postcode_not_listed'
  | 'not_verifiable'
  | 'directory_unavailable';

/** Les états qui valent un avertissement. */
export const POSTCODE_LOCALITY_WARNINGS: ReadonlySet<PostcodeLocalityStatus> = new Set([
  'town_mismatch',
  'other_country',
  'postcode_not_listed',
]);

export interface PostcodeLocalityEntry {
  /** La localité, telle que le répertoire l'écrit. */
  name: string;
  /** La commune où le NPA de cette localité a des adresses. */
  municipality: string;
  /** Le canton ; `null` au Liechtenstein. */
  canton: string | null;
  country: Country;
}

export interface PostcodeLocalityCheck {
  status: PostcodeLocalityStatus;
  /** Les localités que le répertoire donne pour ce NPA ; vide quand il n'en a pas. */
  localities: PostcodeLocalityEntry[];
  /** Ce qui a été comparé et ce qui en sort, en une ou deux phrases. */
  detail: string;
  /** Le répertoire, sa version et la mention ©swisstopo. */
  source: string;
  /** La version du répertoire (AAAA-MM-JJ) ; `null` quand il n'a pas pu être lu. */
  as_of: string | null;
}

const COUNTRY_NAME: Record<Country, string> = { CH: 'Switzerland', LI: 'Liechtenstein' };

/** « 2026-10-01 » → « 01.10.2026 ». */
function dmy(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** La source servie avec chaque réponse construite sur la table. */
export function chLocalitiesSource(table: ChLocalitiesTable | null): string {
  const base =
    'Federal Office of Topography swisstopo, official directory of localities with postcode and perimeter ' +
    `(${CH_LOCALITIES_COLLECTION}, data.geo.admin.ch)`;
  return table
    ? `${base}, version of ${dmy(table.version)}. ${CH_LOCALITIES_ATTRIBUTION}`
    : `${base}. ${CH_LOCALITIES_ATTRIBUTION}`;
}

function entries(rows: readonly ChLocalityRow[]): PostcodeLocalityEntry[] {
  const seen = new Set<string>();
  const out: PostcodeLocalityEntry[] = [];
  for (const r of rows) {
    const id = `${r[2]}|${r[3]}|${r[4]}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ name: r[2], municipality: r[3], canton: r[4] || null, country: countryOf(r) });
  }
  return out;
}

/** « Zürich (municipality Zürich, ZH) » ; les communes d'une même localité regroupées. */
function describe(list: readonly PostcodeLocalityEntry[]): string {
  const byName = new Map<string, string[]>();
  for (const e of list) {
    const where = e.canton ? `${e.municipality}, ${e.canton}` : e.municipality;
    const l = byName.get(e.name);
    if (l) l.push(where);
    else byName.set(e.name, [where]);
  }
  return [...byName]
    .map(
      ([name, where]) =>
        `${name} (${where.length > 1 ? 'municipalities' : 'municipality'} ${where.join('; ')})`,
    )
    .join(', ');
}

const TERRITORY =
  'The directory lists the postcodes of Swiss and Liechtenstein territory, each with its perimeter, so a postcode ' +
  'without a perimeter of its own (a post-office box or business postcode, such as 1211 Genève or 3003 Bern) or a ' +
  'Swiss postcode used outside that territory is not in it.';

const TOLERANCE =
  'The comparison ignores accents, case, "St.", "Sankt" or "Saint", a canton suffix, a sorting number and either ' +
  'half of a bilingual name, and accepts the German, French, Italian and English names of the larger towns.';

/** Le NPA tel qu'écrit, sans préfixe de pays (« CH-8001 ») ni espaces. */
function normalizePostcode(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:CH|LI|FL)\s*-?\s*/i, '')
    .replace(/\s+/g, '');
}

/**
 * Le contrôle d'une adresse. `null` quand il ne s'applique pas : pays autre que
 * CH ou LI, ou NPA ou localité absents (les règles de format le disent déjà).
 */
export function checkPostcodeLocality(address: {
  pst_cd?: string;
  twn_nm?: string;
  ctry?: string;
}): PostcodeLocalityCheck | null {
  const country = (address.ctry ?? '').trim().toUpperCase();
  if (country !== 'CH' && country !== 'LI') return null;
  const rawPostcode = (address.pst_cd ?? '').trim();
  const town = (address.twn_nm ?? '').trim();
  if (!rawPostcode || !town) return null;

  const idx = loadIndexed();
  if (!idx) {
    return {
      status: 'directory_unavailable',
      localities: [],
      detail:
        'The official directory of localities could not be read on this server, so postcode and town were not compared.',
      source: chLocalitiesSource(null),
      as_of: null,
    };
  }
  const source = chLocalitiesSource(idx.table);
  const asOf = idx.table.version;
  const version = dmy(asOf);
  const result = (
    status: PostcodeLocalityStatus,
    localities: PostcodeLocalityEntry[],
    detail: string,
  ): PostcodeLocalityCheck => ({ status, localities, detail, source, as_of: asOf });

  const postcode = normalizePostcode(rawPostcode);
  if (!/^\d{4}$/.test(postcode)) {
    return result(
      'postcode_not_listed',
      [],
      `Postcode "${rawPostcode}" is not a four-digit postcode of the official directory of localities (version of ${version}).`,
    );
  }

  const all = idx.byPostcode.get(postcode) ?? [];
  const here = all.filter((r) => countryOf(r) === country);
  const written = nameVariants(town);

  if (here.length > 0) {
    const list = entries(here);
    const accepted = new Set(here.flatMap(rowKeys));
    if (namesMatch(written, accepted)) {
      return result(
        'match',
        list,
        `The official directory of localities (version of ${version}) lists postcode ${postcode} for ${describe(list)}, ` +
          `and "${town}" is one of these names. The street and the building number are not checked.`,
      );
    }
    return result(
      'town_mismatch',
      list,
      `The official directory of localities (version of ${version}) lists postcode ${postcode} for ${describe(list)}; ` +
        `"${town}" is neither one of these localities nor their municipality. ${TOLERANCE}`,
    );
  }

  if (all.length > 0) {
    const list = entries(all);
    const other = list[0]!.country;
    return result(
      'other_country',
      list,
      `The official directory of localities (version of ${version}) lists postcode ${postcode} in ${COUNTRY_NAME[other]}, ` +
        `for ${describe(list)}, while the address states the country ${country}.`,
    );
  }

  // Le NPA n'est pas au répertoire. La localité écrite y figure-t-elle sous un
  // autre NPA de la même zone postale ? On essaie aussi le nom écrit amputé de
  // ses derniers mots (« Zürich Mülligen » → « Zürich »).
  const names = idx.byName[country as Country];
  const area = postcode.slice(0, 2);
  const nearby = new Set<string>();
  for (const w of written) {
    const words = w.split(' ');
    for (let n = words.length; n >= 1; n--) {
      for (const p of names.get(words.slice(0, n).join(' ')) ?? []) {
        if (p.startsWith(area)) nearby.add(p);
      }
    }
  }
  if (nearby.size > 0) {
    const sorted = [...nearby].sort();
    const shown =
      sorted.slice(0, 8).join(', ') + (sorted.length > 8 ? ` and ${sorted.length - 8} more` : '');
    return result(
      'not_verifiable',
      [],
      `Postcode ${postcode} is not in the official directory of localities (version of ${version}), which lists "${town}" ` +
        `under ${shown} in the same postal area. ${TERRITORY} This pairing is therefore neither confirmed nor contradicted.`,
    );
  }
  return result(
    'postcode_not_listed',
    [],
    `Postcode ${postcode} is not in the official directory of localities for ${COUNTRY_NAME[country as Country]} ` +
      `(version of ${version}), and "${town}" is not listed there in the same postal area. ${TERRITORY}`,
  );
}
