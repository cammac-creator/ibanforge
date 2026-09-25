/**
 * Le registre italien : les « Albi ed elenchi di vigilanza » de la Banca d'Italia
 * (base GIAVA), publiés en open data sous CC BY 4.0.
 *
 *   npx tsx scripts/seed-national.ts IT      # l'Italie seule, jamais avec les autres
 *
 * ## Ce que la source est, et ce qu'elle n'est pas
 *
 * Deux jeux du portail open data de la Banca d'Italia, repris sur dati.gov.it :
 * « Lista intermediari » (VFLUSSO_INTERMEDIARIO, mis à jour chaque jour : l'élenco
 * STORIQUE des intermédiaires, une ligne par période de validité) et « Lista
 * fusioni, incorporazioni, cessioni attività e passività ecc. » (VFLUSSO_EVENTO,
 * chaque semaine). Un code ABI y figure avec son titulaire, ses dates d'inscription
 * et de radiation, et les fusions qui l'ont emporté.
 *
 * 🚨 Ce n'est PAS l'attribution de l'espace ABI : Poste Italiane (07601), la Banca
 * d'Italia elle-même (01000, Trésor) et les succursales d'établissements de
 * paiement européens (Qonto, 36092) émettent de vrais IBAN italiens hors de ces
 * registres (étude du 24/09/2026). Un code trouvé nomme son titulaire, un code
 * absent ne dit rien : l'Italie vit dans NON_EXHAUSTIVE_REGISTERS (enrich.ts),
 * jamais dans NATIONAL_REGISTERS. Ne pas « ranger » cela.
 *
 * ## Filtrer par REGISTRE, jamais par plage de codes
 *
 * `TIPO_ALBO` 001 (banques), 012 (établissements de paiement), 016 (établissements
 * de monnaie électronique) et 010 (l'ancien registre des IMEL, pour l'historique).
 * Des IP portent des codes 19xxx (AGOS-DUCATO 19309) ; les autres registres (SGR,
 * art. 106, OICR) nomment des sociétés qui n'émettent aucun IBAN.
 *
 * ## Le vrai apport : les codes radiés
 *
 * Un code que le registre déclare radié, avec sa date et son successeur légal, est
 * un fait POSITIF du registre, pas une absence. Il est écrit dans une table à part
 * (RETIRED_TABLE), que la branche non exhaustive de decideBankCode lit après une
 * absence dans la table des codes en vigueur. Trois règles, toutes tenues par
 * scripts/seed-national-it.test.ts :
 *
 * - l'historique se lit par DATE, jamais par code seul : un code peut être
 *   réattribué (03111 : Banca Lombarda de 1998 à 2007, puis UBI Banca de 2008 à
 *   2021 ; 03268 : Banca Sella radiée fin 2005 et réinscrite le lendemain sous le
 *   même code). Un code avec un titulaire en vigueur est en vigueur, quoi que dise
 *   son passé ; sinon, c'est son DERNIER titulaire qui fait foi ;
 * - le successeur se suit par ENTITÉ (`ID_INT`), jamais par code, à travers les
 *   seules fusions (002) et incorporations (003), jusqu'à la première entité en
 *   vigueur ; une entité qui a seulement changé de code (BNP Paribas SA, 03181 puis
 *   03479) a pour successeur son nouveau code. Les cessions d'actifs et de guichets
 *   ne font pas de successeur légal ;
 * - ce successeur est LÉGAL, rien de plus : avant son absorption par Intesa
 *   Sanpaolo, UBI avait cédé des guichets à BPER, dont les comptes sont partis chez
 *   BPER. `superseded_by` ne dit jamais « la banque qui tient le compte ».
 *
 * ## L'accès : une poignée de main à cookies
 *
 * Sans pot à cookies, l'adresse de téléchargement répond 302 vers le serveur
 * d'authentification (`auth.bancaditalia.it/oam/…`), qui renvoie vers
 * `infostat…/obrar.cgi`, qui renvoie vers le fichier : trois redirections, les
 * cookies posés en chemin étant exigés à la dernière (mesuré le 25/09/2026). Un
 * chargeur naïf lit une page HTML de 1 Ko et croit le registre vide ; ici une page
 * à la place du ZIP est un refus (`ItalianSourceNotLoaded`), pas un registre vide.
 *
 * ## La licence, portée par la donnée
 *
 * CC BY 4.0 : réutilisation commerciale permise « a condizione di citarne la fonte
 * indicando eventuali modifiche apportate ». Le crédit (auteur, licence et son URI,
 * édition) est écrit dans `source` / `as_of` de chaque ligne, et la mention des
 * modifications (« normalised and joined by IBANforge ») est ajoutée par
 * nationalRegisterCredit('IT'). Le nom servi dans `bank_code_check.register`
 * porte lui aussi l'auteur, la licence, le jeu et la modification : sur un code
 * radié il n'y a aucun bloc `bic` pour porter le crédit à sa place.
 */
import type Database from 'better-sqlite3';
import { appendFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { IT_DATASET_PAGE, RETIRED_TABLE } from '../src/lib/national-registers.js';
import { readZipEntries } from './seed-eba-psd.js';

/** La page d'où l'on télécharge, citée comme adresse du jeu (CC BY 4.0, 3(a)(1)(A)(v)). */
export { IT_DATASET_PAGE };

/** Adresse de téléchargement d'un produit GIAVA, telle que le catalogue DCAT de la Banca d'Italia la publie. */
export function giavaDownloadUrl(product: string): string {
  return `https://infostat.bancaditalia.it/GIAVAInquiry-public/getAreaDownloadExport.do?referenceDate=&product=${product}&language=IT&exportType=CSV&username=OBLIXANONYMOUS&isCompressed=S`;
}

/** Les deux jeux lus, et le nom du CSV que chaque ZIP contient (sa date est l'édition). */
export const IT_FILES = {
  intermediaries: {
    product: 'VFLUSSO_INTERMEDIARIO',
    member: /^(\d{4}-\d{2}-\d{2})_INTERMEDIARI\.csv$/,
  },
  events: {
    product: 'VFLUSSO_EVENTO',
    member: /^(\d{4}-\d{2}-\d{2})_EVENTI_STRUTTURALI\.csv$/,
  },
} as const;

/**
 * Les registres dont un code peut figurer dans un IBAN : banques (001),
 * établissements de paiement (012), de monnaie électronique (016) et l'ancien
 * registre des IMEL (010, pour l'historique seulement : plus aucune ligne en
 * vigueur).
 */
export const IBAN_REGISTERS: ReadonlySet<string> = new Set(['001', '012', '016', '010']);

/** Ce que veut dire `DATA_F_VAL` pour une période encore ouverte. */
const OPEN_ENDED = '9999-12-31';

/**
 * Planchers mesurés le 25/09/2026 sur l'édition du 23/09/2026 : 24 313 lignes
 * d'historique, 464 codes en vigueur, 1 907 codes radiés, 3 368 événements. Posés
 * bien en dessous, pour qu'un mois ordinaire (quelques fusions de banques
 * coopératives) ne bloque rien, et bien au-dessus de ce qu'un fichier tronqué ou
 * un format changé donnerait.
 */
export const IT_FLOORS = {
  intermediaryRows: 20_000,
  inForce: 400,
  retired: 1_600,
  events: 3_000,
} as const;

/** Même en-tête de navigateur que les autres registres ; aucune adresse mail. */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

/**
 * La Banca d'Italia ne sert pas le registre aujourd'hui : injoignable, page à la
 * place du fichier, ou édition plus ancienne que celle déjà chargée. Les tables
 * italiennes restent telles quelles, le workflow sonne l'alarme. Un fichier dont
 * la FORME a changé lève une Error ordinaire : c'est ce qu'un humain doit lire.
 * Même doctrine que CzechSourceNotLoaded.
 */
export class ItalianSourceNotLoaded extends Error {}

/** Le réseau, injectable pour que les tests suivent tout le chemin sans lui. */
export type ItalianFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Un serveur qui envoie ses en-têtes puis se tait ne doit pas tenir le workflow. */
const IT_FETCH_TIMEOUT_MS = 120_000;

/** Au-delà, ce n'est plus une poignée de main mais une boucle. */
const MAX_REDIRECTS = 8;

interface Cookie {
  name: string;
  value: string;
  /** Domaine sans point de tête ; `hostOnly` quand l'en-tête n'en donnait pas. */
  domain: string;
  hostOnly: boolean;
}

/** Lit un en-tête Set-Cookie : nom, valeur et domaine, le reste n'importe pas ici. */
function parseSetCookie(header: string, host: string): Cookie | null {
  const [pair, ...attributes] = header.split(';');
  const eq = pair.indexOf('=');
  if (eq <= 0) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  let domain = host;
  let hostOnly = true;
  for (const attribute of attributes) {
    const [k, v] = attribute.split('=');
    if (k.trim().toLowerCase() === 'domain' && v?.trim()) {
      domain = v.trim().replace(/^\./, '').toLowerCase();
      hostOnly = false;
    }
  }
  return { name, value, domain, hostOnly };
}

function cookieFor(cookie: Cookie, host: string): boolean {
  if (cookie.hostOnly) return host === cookie.domain;
  return host === cookie.domain || host.endsWith(`.${cookie.domain}`);
}

/**
 * Télécharge un fichier GIAVA en suivant la poignée de main : redirections
 * suivies À LA MAIN (fetch n'emporte pas les cookies d'un saut à l'autre), un
 * pot à cookies par téléchargement, chaque cookie renvoyé au seul domaine qui
 * l'a posé.
 *
 * Toute défaillance du RÉSEAU (pas de réponse, statut d'erreur, délai, connexion
 * coupée pendant le corps, trop de redirections) devient ItalianSourceNotLoaded.
 */
export async function giavaDownload(fetchImpl: ItalianFetch, url: string): Promise<Buffer> {
  const jar = new Map<string, Cookie>();
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const host = new URL(current).hostname.toLowerCase();
      const cookies = [...jar.values()]
        .filter((c) => cookieFor(c, host))
        .map((c) => `${c.name}=${c.value}`);
      const res = await fetchImpl(current, {
        redirect: 'manual',
        headers: { 'User-Agent': UA, ...(cookies.length ? { Cookie: cookies.join('; ') } : {}) },
        signal: AbortSignal.timeout(IT_FETCH_TIMEOUT_MS),
      });
      for (const header of res.headers.getSetCookie()) {
        const cookie = parseSetCookie(header, host);
        if (cookie) jar.set(`${cookie.domain}\u0000${cookie.name}`, cookie);
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        // Le corps d'une redirection est une page de 1 Ko : lu pour libérer la
        // connexion, jamais pris pour le fichier.
        await res.arrayBuffer().catch(() => undefined);
        if (!location) {
          throw new ItalianSourceNotLoaded(`${current} -> HTTP ${res.status} without a Location`);
        }
        current = new URL(location, current).toString();
        continue;
      }
      if (!res.ok) throw new ItalianSourceNotLoaded(`${current} -> HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
  } catch (e) {
    if (e instanceof ItalianSourceNotLoaded) throw e;
    throw new ItalianSourceNotLoaded(`${url}: ${e instanceof Error ? e.message : String(e)}`);
  }
  throw new ItalianSourceNotLoaded(`${url}: more than ${MAX_REDIRECTS} redirects`);
}

/** Une page, là où un ZIP était attendu : la première lettre suffit à le dire. */
function looksLikeHtml(buf: Buffer): boolean {
  return buf
    .subarray(0, 512)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart()
    .startsWith('<');
}

/** 'AAAA-MM-JJ' si le calendrier connaît ce jour, null sinon. */
function realDate(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const probe = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

export interface GiavaFile {
  /** Le nom du CSV dans l'archive, par exemple `2026-09-23_INTERMEDIARI.csv`. */
  member: string;
  /** L'édition, lue dans ce nom : le seul endroit où la source la date. */
  edition: string;
  text: string;
}

/**
 * Le CSV d'une archive GIAVA, et l'édition que son nom porte.
 *
 * L'édition est prise dans le nom du membre, jamais dans une horloge ni dans
 * `dct:modified` du catalogue (qui date les métadonnées) : c'est la moitié datée
 * du crédit. Une archive qui ne contient plus le fichier attendu est un format
 * changé : Error ordinaire.
 */
export function readGiavaZip(buf: Buffer, member: RegExp): GiavaFile {
  if (looksLikeHtml(buf)) {
    const hint = buf.subarray(0, 200).toString('utf8').replace(/\s+/g, ' ').trim().slice(0, 120);
    throw new ItalianSourceNotLoaded(
      `the Banca d'Italia answered a page, not the file ("${hint}")`,
    );
  }
  const entries = readZipEntries(buf);
  const entry = entries.find((e) => member.test(e.name));
  if (!entry) {
    throw new Error(
      `IT: the archive holds ${entries.map((e) => e.name).join(', ') || 'nothing'}, not a file named like ${member}: format changed`,
    );
  }
  const edition = realDate(member.exec(entry.name)?.[1] ?? '');
  if (!edition) throw new Error(`IT: "${entry.name}" does not name a real edition date`);
  let raw: Buffer;
  if (entry.method === 8) raw = inflateRawSync(entry.compressed);
  else if (entry.method === 0) raw = Buffer.from(entry.compressed);
  else throw new Error(`IT: "${entry.name}" uses ZIP method ${entry.method}, expected deflate`);
  return { member: entry.name, edition, text: new TextDecoder('utf-8').decode(raw) };
}

/**
 * Un CSV GIAVA : UTF-8 avec BOM, séparateur `;`, champs rembourrés d'une espace,
 * fins de ligne LF, et des guillemets LITTÉRAUX (« C.D. "ALBO UNICO" ») qui ne
 * sont pas des délimiteurs : un analyseur CSV classique les mangerait. Chaque
 * ligne doit porter autant de champs que l'en-tête ; sinon le séparateur ou la
 * mise entre guillemets ont changé, et c'est une Error, pas un registre plus court.
 */
export function parseGiavaCsv(
  text: string,
  required: readonly string[],
  label: string,
): Array<Record<string, string>> {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length === 0) throw new Error(`IT: the ${label} file is empty`);
  const header = lines[0].split(';').map((h) => h.trim());
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    throw new Error(`IT: the ${label} file lacks ${missing.join(', ')}: format changed`);
  }
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i].split(';');
    if (fields.length !== header.length) {
      throw new Error(
        `IT: line ${i + 1} of the ${label} file has ${fields.length} fields where the header has ${header.length}: the separator or the quoting changed`,
      );
    }
    const row: Record<string, string> = {};
    header.forEach((h, j) => (row[h] = fields[j].trim()));
    rows.push(row);
  }
  return rows;
}

/** Une période de validité d'un intermédiaire, telle que l'historique la publie. */
export interface IntermediaryRow {
  /** Identifiant de l'ENTITÉ (`ID_INT`) : stable quand le code change. */
  id: string;
  /** Code ABI ramené à cinq chiffres (`COD_MECC` s'écrit sans zéro de tête). */
  code: string;
  register: string;
  name: string;
  street: string | null;
  post_code: string | null;
  town: string | null;
  lei: string | null;
  valid_from: string;
  valid_to: string;
}

export interface EventRow {
  type: string;
  effective: string;
  active_id: string;
  passive_id: string;
}

const INTERMEDIARY_COLUMNS = [
  'ID_INT',
  'COD_MECC',
  'TIPO_ALBO',
  'DEN_INT',
  'INDIRIZZO_SL',
  'CAP_SL',
  'DES_COM_ITA_SL',
  'COD_LEI',
  'DATA_I_VAL',
  'DATA_F_VAL',
] as const;

const EVENT_COLUMNS = ['TIPO_EVENTO', 'DATA_EFFICACIA', 'ID_INT_ATT', 'ID_INT_PAS'] as const;

/**
 * Les périodes des registres qui portent des codes d'IBAN, et elles seules.
 *
 * Une ligne sans code, ou dont une date ne se lit pas, est écartée et comptée :
 * l'historique de 1936 compte des lignes sans `COD_MECC` (le Credito Italiano
 * jusqu'en 1960), qui ne peuvent rien dire d'un IBAN.
 */
export function parseIntermediaries(text: string): {
  rows: IntermediaryRow[];
  total: number;
  skipped: number;
} {
  const raw = parseGiavaCsv(text, INTERMEDIARY_COLUMNS, 'intermediaries');
  const rows: IntermediaryRow[] = [];
  let skipped = 0;
  for (const r of raw) {
    if (!IBAN_REGISTERS.has(r.TIPO_ALBO)) continue;
    const digits = r.COD_MECC;
    const from = realDate(r.DATA_I_VAL);
    const to = r.DATA_F_VAL === OPEN_ENDED ? OPEN_ENDED : realDate(r.DATA_F_VAL);
    if (!/^\d{1,5}$/.test(digits) || !r.ID_INT || !r.DEN_INT || !from || !to) {
      skipped++;
      continue;
    }
    rows.push({
      id: r.ID_INT,
      code: digits.padStart(5, '0'),
      register: r.TIPO_ALBO,
      // Tel que publié, bords seuls rognés : les doubles espaces internes de
      // certaines banques coopératives font partie du nom publié.
      name: r.DEN_INT,
      // Le siège légal en Italie. Pour une banque étrangère, c'est l'adresse de
      // sa succursale italienne (N26 Bank SE : via Sassetti, Milan), qui est
      // l'entité titulaire du code ; son siège à l'étranger n'est pas servi.
      street: r.INDIRIZZO_SL || null,
      post_code: r.CAP_SL || null,
      town: r.DES_COM_ITA_SL || null,
      lei: r.COD_LEI || null,
      valid_from: from,
      valid_to: to,
    });
  }
  return { rows, total: raw.length, skipped };
}

/** Les événements, tous types : le tri entre fusion, incorporation et cession se fait plus loin. */
export function parseEvents(text: string): EventRow[] {
  return parseGiavaCsv(text, EVENT_COLUMNS, 'events')
    .filter((r) => r.ID_INT_ATT && r.ID_INT_PAS && realDate(r.DATA_EFFICACIA))
    .map((r) => ({
      type: r.TIPO_EVENTO,
      effective: r.DATA_EFFICACIA,
      active_id: r.ID_INT_ATT,
      passive_id: r.ID_INT_PAS,
    }));
}

/** Les deux types d'événement qui font un successeur LÉGAL : fusion et incorporation. */
const SUCCESSION_EVENTS: ReadonlySet<string> = new Set(['002', '003']);

export interface InForceCode {
  code: string;
  name: string;
  register: string;
  street: string | null;
  post_code: string | null;
  town: string | null;
  lei: string | null;
}

export interface RetiredCode {
  code: string;
  /** Le DERNIER titulaire du code, tel que le registre l'écrivait alors. */
  name: string;
  /** Dernier jour où le registre porte ce code pour ce titulaire. */
  retired_on: string;
  /** Le successeur légal en vigueur aujourd'hui, s'il en existe un. */
  successor_code: string | null;
  successor_name: string | null;
}

export interface ItalianRegister {
  inForce: InForceCode[];
  retired: RetiredCode[];
  /** Codes laissés de côté parce que deux titulaires y sont en vigueur à la fois. */
  ambiguous: string[];
}

/** Au-delà, la chaîne de successions est une donnée incohérente, pas une histoire. */
const MAX_SUCCESSION_DEPTH = 20;

/**
 * Qui est en vigueur, qui est radié, et qui succède à qui.
 *
 * Pur : les tests le tiennent sur des historiques inventés qui reproduisent les
 * cas réels (réattribution, changement de code, chaîne de fusions, cession).
 */
export function buildItalianRegister(
  rows: readonly IntermediaryRow[],
  events: readonly EventRow[],
): ItalianRegister {
  const byCode = new Map<string, IntermediaryRow[]>();
  const currentById = new Map<string, IntermediaryRow>();
  for (const r of rows) {
    byCode.set(r.code, [...(byCode.get(r.code) ?? []), r]);
    if (r.valid_to === OPEN_ENDED) currentById.set(r.id, r);
  }
  // Pour chaque entité absorbée, l'événement qui l'a absorbée. Mesuré sur
  // l'édition du 23/09/2026 : aucune entité n'est le passif de deux fusions ou
  // incorporations ; si cela arrivait, la plus récente l'emporte.
  const absorbedBy = new Map<string, EventRow>();
  for (const e of events) {
    if (!SUCCESSION_EVENTS.has(e.type)) continue;
    const seen = absorbedBy.get(e.passive_id);
    if (!seen || e.effective > seen.effective) absorbedBy.set(e.passive_id, e);
  }

  const successorOf = (id: string): IntermediaryRow | null => {
    const visited = new Set<string>();
    let at = id;
    for (let depth = 0; depth <= MAX_SUCCESSION_DEPTH; depth++) {
      if (visited.has(at)) return null;
      visited.add(at);
      const alive = currentById.get(at);
      if (alive) return alive;
      const event = absorbedBy.get(at);
      if (!event) return null;
      at = event.active_id;
    }
    return null;
  };

  const inForce: InForceCode[] = [];
  const retired: RetiredCode[] = [];
  const ambiguous: string[] = [];
  for (const [code, history] of [...byCode.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const current = history.filter((r) => r.valid_to === OPEN_ENDED);
    const holders = new Set(current.map((r) => r.id));
    if (holders.size > 1) {
      // Jamais vu (mesuré le 25/09/2026) ; si cela arrive, aucun des deux ne
      // peut être nommé, et le code retombe sur la réponse d'avant le registre.
      ambiguous.push(code);
      continue;
    }
    if (current.length > 0) {
      const r = current[current.length - 1];
      inForce.push({
        code,
        name: r.name,
        register: r.register,
        street: r.street,
        post_code: r.post_code,
        town: r.town,
        lei: r.lei,
      });
      continue;
    }
    // Radié : c'est le DERNIER titulaire qui fait foi, celui dont la période se
    // termine le plus tard (à égalité, celle qui commence le plus tard).
    const last = history.reduce((a, b) =>
      b.valid_to > a.valid_to || (b.valid_to === a.valid_to && b.valid_from > a.valid_from) ? b : a,
    );
    const successor = successorOf(last.id);
    retired.push({
      code,
      name: last.name,
      retired_on: last.valid_to,
      successor_code: successor && successor.code !== code ? successor.code : null,
      successor_name: successor && successor.code !== code ? successor.name : null,
    });
  }
  return { inForce, retired, ambiguous };
}

/**
 * Le crédit que la licence exige, écrit dans chaque ligne : l'auteur, le jeu et
 * la licence avec son URI. L'édition voyage à côté, dans `as_of`, et la mention
 * des modifications est ajoutée par nationalRegisterCredit('IT').
 */
export function italianSource(): string {
  return "Banca d'Italia, Albi ed elenchi di vigilanza (open data, CC BY 4.0, https://creativecommons.org/licenses/by/4.0/)";
}

/** La table des codes radiés, créée si elle manque. Ses colonnes sont décrites dans national-registers.ts. */
export function ensureRetiredTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS ${RETIRED_TABLE} (
      country        TEXT NOT NULL,
      code           TEXT NOT NULL,
      name           TEXT NOT NULL,
      retired_on     TEXT NOT NULL,
      successor_code TEXT,
      successor_name TEXT,
      source         TEXT,
      as_of          TEXT,
      PRIMARY KEY (country, code)
    );`);
}

export interface ItalianEdition {
  /** L'édition du fichier des intermédiaires, qui date le registre servi. */
  intermediaries: string;
  events: string;
}

/**
 * Écrit l'Italie, les deux tables dans UNE transaction.
 *
 * Refusés, les tables restant intactes : une édition sous les planchers (Error
 * ordinaire : fichier tronqué ou format changé, pour un humain), et une édition
 * PLUS ANCIENNE que celle déjà servie (ItalianSourceNotLoaded : une copie en cache
 * ressemblerait à cela, et revenir en arrière rendrait vivants des codes radiés).
 */
export function writeItalian(
  db: Database.Database,
  register: ItalianRegister,
  edition: ItalianEdition,
): void {
  if (register.inForce.length < IT_FLOORS.inForce) {
    throw new Error(
      `IT: only ${register.inForce.length} codes in force, expected at least ${IT_FLOORS.inForce}. Refusing to replace the tables.`,
    );
  }
  if (register.retired.length < IT_FLOORS.retired) {
    throw new Error(
      `IT: only ${register.retired.length} retired codes, expected at least ${IT_FLOORS.retired}. Refusing to replace the tables.`,
    );
  }
  ensureRetiredTable(db);
  const stored = db
    .prepare(`SELECT MAX(as_of) AS as_of FROM national_bank_codes WHERE country = 'IT'`)
    .get() as { as_of: string | null } | undefined;
  if (stored?.as_of && stored.as_of > edition.intermediaries) {
    throw new ItalianSourceNotLoaded(
      `IT: the API already serves the edition of ${stored.as_of} while the Banca d'Italia served ${edition.intermediaries}. Refusing to go back an edition.`,
    );
  }
  const source = italianSource();
  const as_of = edition.intermediaries;
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM national_bank_codes WHERE country = 'IT'`).run();
    const insertCode = db.prepare(
      `INSERT INTO national_bank_codes (country, code, name, bic, street, post_code, town, lei, source, as_of)
       VALUES ('IT', ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    );
    for (const c of register.inForce) {
      insertCode.run(c.code, c.name, c.street, c.post_code, c.town, c.lei, source, as_of);
    }
    db.prepare(`DELETE FROM ${RETIRED_TABLE} WHERE country = 'IT'`).run();
    const insertRetired = db.prepare(
      `INSERT INTO ${RETIRED_TABLE} (country, code, name, retired_on, successor_code, successor_name, source, as_of)
       VALUES ('IT', ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of register.retired) {
      insertRetired.run(
        r.code,
        r.name,
        r.retired_on,
        r.successor_code,
        r.successor_name,
        source,
        as_of,
      );
    }
  });
  tx();
  const withSuccessor = register.retired.filter((r) => r.successor_code).length;
  console.log(
    `  IT: edition ${edition.intermediaries} (events ${edition.events}): ${register.inForce.length} codes in force, ${register.retired.length} retired (${withSuccessor} with a legal successor in force)`,
  );
  if (register.ambiguous.length > 0) {
    console.warn(
      `  IT: ${register.ambiguous.length} codes left out, two holders in force at once: ${register.ambiguous.join(', ')}`,
    );
  }
}

export interface ItalianSeedOptions {
  /** Le réseau ; `fetch` en production, un bouchon dans les tests. */
  fetchImpl?: ItalianFetch;
}

/**
 * Télécharge les deux jeux, construit le registre et l'écrit.
 *
 * Le fichier des événements est hebdomadaire, celui des intermédiaires
 * quotidien : un écart de quelques jours entre les deux éditions est l'état
 * normal. Au-delà d'un mois, les fusions récentes manqueraient : le chargement
 * se fait quand même (une fusion manquante ne coûte qu'un successeur non
 * annoncé), et le journal le dit.
 */
export async function seedItalianLive(
  db: Database.Database,
  options: ItalianSeedOptions = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const interFile = readGiavaZip(
    await giavaDownload(fetchImpl, giavaDownloadUrl(IT_FILES.intermediaries.product)),
    IT_FILES.intermediaries.member,
  );
  const eventFile = readGiavaZip(
    await giavaDownload(fetchImpl, giavaDownloadUrl(IT_FILES.events.product)),
    IT_FILES.events.member,
  );
  console.log(`  IT: read ${interFile.member} and ${eventFile.member}`);
  const { rows, total, skipped } = parseIntermediaries(interFile.text);
  if (total < IT_FLOORS.intermediaryRows) {
    throw new Error(
      `IT: only ${total} history lines in ${interFile.member}, expected at least ${IT_FLOORS.intermediaryRows}. Refusing the file.`,
    );
  }
  if (skipped > 0) console.log(`  IT: ${skipped} history lines without a code or a date, left out`);
  const events = parseEvents(eventFile.text);
  if (events.length < IT_FLOORS.events) {
    throw new Error(
      `IT: only ${events.length} events in ${eventFile.member}, expected at least ${IT_FLOORS.events}. Refusing the file.`,
    );
  }
  const lagDays =
    (Date.parse(`${interFile.edition}T00:00:00Z`) - Date.parse(`${eventFile.edition}T00:00:00Z`)) /
    86_400_000;
  if (lagDays > 31) {
    console.warn(
      `  IT: the events file (${eventFile.edition}) is ${lagDays} days older than the intermediaries (${interFile.edition}); recent mergers may be missing`,
    );
  }
  writeItalian(db, buildItalianRegister(rows, events), {
    intermediaries: interFile.edition,
    events: eventFile.edition,
  });
}

/** Une commande de workflow tient sur une ligne : %, CR et LF sont échappés. */
function workflowData(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/**
 * Dit au workflow ce qu'est devenu le registre italien, comme reportCzechStatus :
 * `not_loaded` écrit une annotation `::warning::` et, sous Actions,
 * `it_register=not_loaded` dans $GITHUB_OUTPUT, que refresh-it-register.yml
 * change en étape rouge et en alerte Telegram. Le code de sortie reste 0.
 */
export function reportItalianStatus(
  status: 'loaded' | 'not_loaded',
  message = '',
  env: NodeJS.ProcessEnv = process.env,
  log: (line: string) => void = console.log,
): void {
  if (status === 'not_loaded') {
    log(
      `::warning title=Italian register not loaded::${workflowData(`${message}; the Italian tables stay as they were`)}`,
    );
  }
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `it_register=${status}\n`);
}
