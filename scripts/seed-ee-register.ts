/**
 * Relecture du registre estonien : les codes d'identification des numéros de
 * compte internationaux de la Finantsinspektsioon, et le BIC d'Eesti Pangaliit.
 *
 *   npx tsx scripts/seed-ee-register.ts            # écrit le fichier PRIVÉ
 *   npx tsx scripts/seed-ee-register.ts --check    # compare, n'écrit rien (sortie 1 si ça diffère)
 *
 * Le fichier est PRIVÉ : `EE_REGISTER_PATH` si la variable est posée, sinon
 * docs/internal/registres-ee-me-2026-10-08/ee-register.json (dossier ignoré par
 * git). Le script refuse un chemin qu'un dépôt git suivrait : la permission de la
 * Finantsinspektsioon porte sur les réponses de l'API, la table entière n'entre
 * pas dans le dépôt public (scripts/private-register-path.ts).
 *
 * Trois pages publiques sont lues (adresses dans src/lib/ee-register.ts) :
 *  - les établissements de crédit, avec leurs succursales étrangères ;
 *  - les établissements de paiement et de monnaie électronique, avec leurs succursales ;
 *  - la liste d'Eesti Pangaliit, UNIQUEMENT pour le BIC.
 *
 * Les codes viennent de la Finantsinspektsioon, jamais de Pangaliit : trois codes
 * que Pangaliit liste encore (00, 83, 99) ne figurent pas sur les pages de
 * l'autorité le 08/10/2026 et ne sont pas importés. Le BIC se joint PAR LE CODE, à
 * condition que le nom soit le même des deux côtés ; sinon `bic: null` et un
 * avertissement. Aucun BIC n'est jamais déduit d'un nom.
 *
 * Une page qui change de forme (en-tête inconnu, code illisible, date absente,
 * tableau imbriqué) fait ÉCHOUER le script : on ne devine pas. Un fichier plus
 * court qu'un plancher est un téléchargement tronqué. Une baisse du nombre de
 * codes est refusée sans `--accept-loss` : un retrait d'agrément est possible, mais
 * un humain le lit d'abord.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EE_BIC_PAGE,
  EE_BIC_SOURCE,
  EE_CREDIT_PAGE,
  EE_PAYMENT_PAGE,
  EE_SOURCE,
  eeRegisterSchema,
  type EeKind,
  type EeRegister,
} from '../src/lib/ee-register.js';
import { cellText, parseHtmlTables } from './html-tables.js';
import { assertPrivateRegisterPath, privateRegisterPath } from './private-register-path.js';

/** Le fichier PRIVÉ : `EE_REGISTER_PATH`, sinon le dossier ignoré par git. */
export const eeRegisterPath = (): string =>
  privateRegisterPath('EE_REGISTER_PATH', 'ee-register.json');

/** Mesuré le 08/10/2026 : 10 codes (établissements de crédit), 9 (paiement), 12 BIC. */
export const EE_FLOORS = { credit_institutions: 8, payment_institutions: 6, bic: 8 } as const;

type FiPage = 'credit_institutions' | 'payment_institutions';

/** L'en-tête de la première colonne de chaque tableau de l'autorité, et la sorte qu'il désigne. */
const FI_TABLE_KINDS: Record<FiPage, Record<string, EeKind>> = {
  credit_institutions: {
    'Credit institution': 'credit_institution',
    'Branch of a foreign credit institution': 'foreign_credit_institution_branch',
  },
  payment_institutions: {
    'Payment or e-money institution': 'payment_or_e_money_institution',
    'Branch of foreign payment institution': 'foreign_payment_institution_branch',
  },
};

export interface FiEntry {
  code: string;
  name: string;
  kind: EeKind;
}

/** « Page last edited on 25/08/2025 » devient 2025-08-25 ; une page sans date est refusée. */
export function parseFiEdited(html: string): string {
  const match = /Page last edited on\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(html);
  if (!match) throw new Error('EE : la page ne porte plus « Page last edited on JJ/MM/AAAA »');
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  if (new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso) {
    throw new Error(`EE : date de modification invalide (${match[0]})`);
  }
  return iso;
}

/** Les codes d'un nombre de chiffres donné, séparés par une espace, une barre oblique ou une virgule. */
function splitCodes(lines: readonly string[]): string[] {
  return lines.flatMap((line) => line.split(/[\s/,;]+/)).filter((part) => part !== '');
}

/**
 * Les tableaux d'une page de l'autorité. Un tableau « Identity code » dont le
 * premier en-tête est inconnu fait échouer la lecture : c'est une forme nouvelle.
 */
export function parseFiPage(
  html: string,
  page: FiPage,
  /** Le plancher de codes de la page ; les essais sur fragments réduits le baissent. */
  minCodes: number = EE_FLOORS[page],
): { edited: string; entries: FiEntry[] } {
  const edited = parseFiEdited(html);
  const entries: FiEntry[] = [];
  const seen = new Set<string>();
  let mainTables = 0;
  for (const table of parseHtmlTables(html)) {
    const header = table.rows[0];
    if (!header?.header || cellText(header.cells[1]) !== 'Identity code') continue;
    const first = cellText(header.cells[0]);
    const kind = FI_TABLE_KINDS[page][first];
    if (!kind) throw new Error(`EE : tableau inconnu « ${first} » sur la page ${page}`);
    if (kind === 'credit_institution' || kind === 'payment_or_e_money_institution') mainTables += 1;
    for (const row of table.rows.slice(1)) {
      const name = cellText(row.cells[0]);
      const codes = splitCodes(row.cells[1] ?? []);
      // La ligne vide (deux &nbsp;) qui termine un tableau.
      if (name === '' && codes.length === 0) continue;
      if (name === '' || codes.length === 0) {
        throw new Error(`EE : ligne incomplète dans « ${first} » (${name || 'sans nom'})`);
      }
      for (const code of codes) {
        if (!/^\d{2}$/.test(code)) throw new Error(`EE : code illisible « ${code} » (${name})`);
        if (seen.has(code)) throw new Error(`EE : code ${code} listé deux fois sur la même page`);
        seen.add(code);
        entries.push({ code, name, kind });
      }
    }
  }
  if (mainTables !== 1) {
    throw new Error(`EE : ${mainTables} tableau(x) principal(aux) sur la page ${page}, un attendu`);
  }
  if (entries.length < minCodes) {
    throw new Error(
      `EE : ${entries.length} codes sur la page ${page}, en dessous du plancher de ${minCodes}`,
    );
  }
  return { edited, entries };
}

export interface PangaliitRow {
  code: string;
  name: string;
  bic: string | null;
}

/** La liste d'Eesti Pangaliit : un code par ligne (« 96 / 17 » en donne deux), avec son BIC éventuel. */
export function parsePangaliit(html: string, minBic: number = EE_FLOORS.bic): PangaliitRow[] {
  const table = parseHtmlTables(html).find((candidate) => {
    const cells = candidate.rows[0]?.cells ?? [];
    return (
      cellText(cells[0]) === 'Bank' &&
      cellText(cells[1]) === 'BIC / SWIFT' &&
      cellText(cells[2]) === 'IBAN identifier'
    );
  });
  if (!table) throw new Error('EE : le tableau « Bank / BIC / SWIFT / IBAN identifier » a disparu');
  const rows: PangaliitRow[] = [];
  const seen = new Set<string>();
  for (const row of table.rows.slice(1)) {
    // Les lignes de section (« Payment institutions and e-money institutions »).
    if (row.header) continue;
    const name = cellText(row.cells[0]);
    const bic = cellText(row.cells[1]).replace(/\s+/g, '');
    const codes = splitCodes(row.cells[2] ?? []);
    if (name === '' && bic === '' && codes.length === 0) continue;
    if (name === '' || codes.length === 0) {
      throw new Error(`EE : ligne Pangaliit incomplète (${name || 'sans nom'})`);
    }
    if (bic !== '' && !/^[A-Z]{4}EE[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(bic)) {
      throw new Error(`EE : BIC illisible « ${bic} » (${name})`);
    }
    for (const code of codes) {
      if (!/^\d{2}$/.test(code)) throw new Error(`EE : code Pangaliit illisible « ${code} »`);
      if (seen.has(code)) throw new Error(`EE : code ${code} listé deux fois par Pangaliit`);
      seen.add(code);
      rows.push({ code, name, bic: bic || null });
    }
  }
  const withBic = rows.filter((row) => row.bic).length;
  if (withBic < minBic) {
    throw new Error(`EE : ${withBic} BIC chez Pangaliit, en dessous du plancher de ${minBic}`);
  }
  return rows;
}

/** Deux noms sont les mêmes à la casse, aux espaces et à la forme Unicode près, rien de plus. */
function sameName(a: string, b: string): boolean {
  const normal = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  return normal(a) === normal(b);
}

export interface EeBuild {
  register: EeRegister;
  /** Ce qui n'a pas pu être joint ou pas été importé, pour le journal du script. */
  notes: string[];
}

/**
 * Le fichier complet. L'autorité fait foi pour les codes ; Pangaliit ne fournit que
 * des BIC, joints par le code et le nom identique.
 */
export function buildEeRegister(input: {
  creditHtml: string;
  paymentHtml: string;
  pangaliitHtml: string;
  readOn: string;
  /** Les planchers (EE_FLOORS par défaut) ; seuls les essais sur fragments réduits les baissent. */
  floors?: Partial<Record<keyof typeof EE_FLOORS, number>>;
}): EeBuild {
  const floors = { ...EE_FLOORS, ...input.floors };
  const credit = parseFiPage(input.creditHtml, 'credit_institutions', floors.credit_institutions);
  const payment = parseFiPage(
    input.paymentHtml,
    'payment_institutions',
    floors.payment_institutions,
  );
  const bics = new Map(
    parsePangaliit(input.pangaliitHtml, floors.bic).map((row) => [row.code, row]),
  );
  const notes: string[] = [];
  const entries: EeRegister['entries'] = [];
  for (const entry of [...credit.entries, ...payment.entries]) {
    if (entries.some((known) => known.code === entry.code)) {
      throw new Error(`EE : code ${entry.code} listé sur les deux pages de l'autorité`);
    }
    const listed = bics.get(entry.code);
    let bic: string | null = null;
    if (listed?.bic && sameName(listed.name, entry.name)) {
      bic = listed.bic;
    } else if (listed?.bic) {
      notes.push(
        `code ${entry.code} : « ${entry.name} » (autorité) et « ${listed.name} » (Pangaliit) diffèrent, BIC non joint`,
      );
    } else {
      notes.push(`code ${entry.code} : « ${entry.name} », aucun BIC chez Pangaliit`);
    }
    entries.push({ ...entry, bic });
  }
  const known = new Set(entries.map((entry) => entry.code));
  for (const row of bics.values()) {
    if (!known.has(row.code)) {
      notes.push(
        `code ${row.code} : « ${row.name} » listé par Pangaliit, absent des pages de l'autorité, non importé`,
      );
    }
  }
  const register = eeRegisterSchema.parse({
    schema: 1,
    source: EE_SOURCE,
    pages: {
      credit_institutions: { url: EE_CREDIT_PAGE, edited: credit.edited },
      payment_institutions: { url: EE_PAYMENT_PAGE, edited: payment.edited },
    },
    bic_source: { name: EE_BIC_SOURCE, url: EE_BIC_PAGE },
    read_on: input.readOn,
    entries,
  });
  return { register, notes };
}

/** Le fichier tel qu'il s'écrit : l'en-tête déployé, un établissement par ligne (un diff lisible). */
export function formatEeRegister(register: EeRegister): string {
  const { entries, ...head } = register;
  const headText = JSON.stringify(head, null, 2).slice(0, -2);
  const rows = entries.map((entry) => `    ${JSON.stringify(entry)}`).join(',\n');
  return `${headText},\n  "entries": [\n${rows}\n  ]\n}\n`;
}

/** Ce qui change entre deux éditions, hors le jour de lecture. Vide : rien à écrire. */
export function diffEeRegisters(previous: EeRegister, next: EeRegister): string[] {
  const out: string[] = [];
  for (const page of ['credit_institutions', 'payment_institutions'] as const) {
    if (previous.pages[page].edited !== next.pages[page].edited) {
      out.push(
        `page ${page} : modifiée le ${previous.pages[page].edited}, maintenant ${next.pages[page].edited}`,
      );
    }
  }
  const before = new Map(previous.entries.map((entry) => [entry.code, entry]));
  const after = new Map(next.entries.map((entry) => [entry.code, entry]));
  for (const [code, entry] of after) {
    const old = before.get(code);
    if (!old) out.push(`code ${code} ajouté : ${entry.name}`);
    else if (JSON.stringify(old) !== JSON.stringify(entry)) {
      out.push(`code ${code} modifié : ${JSON.stringify(old)} devient ${JSON.stringify(entry)}`);
    }
  }
  for (const [code, entry] of before) {
    if (!after.has(code)) out.push(`code ${code} retiré : ${entry.name}`);
  }
  return out;
}

/** Écrit le fichier, atomiquement, après avoir refusé un recul de date ou une baisse du nombre de codes. */
export function writeEeRegister(
  path: string,
  register: EeRegister,
  options: { acceptLoss?: boolean } = {},
): void {
  assertPrivateRegisterPath(path);
  const checked = eeRegisterSchema.parse(register);
  if (existsSync(path)) {
    const previous = eeRegisterSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    if (checked.read_on < previous.read_on) {
      throw new Error('EE : le jour de lecture recule, contrôle manuel requis');
    }
    const lost = previous.entries.filter(
      (entry) => !checked.entries.some((fresh) => fresh.code === entry.code),
    );
    if (lost.length > 0 && !options.acceptLoss) {
      throw new Error(
        `EE : ${lost.length} code(s) disparaissent (${lost.map((entry) => entry.code).join(', ')}) : contrôle manuel requis, puis --accept-loss`,
      );
    }
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, formatEeRegister(checked), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

async function download(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
    headers: { 'User-Agent': 'IBANforge/1.0 (+https://ibanforge.com)' },
  });
  if (!response.ok) throw new Error(`EE : HTTP ${response.status} sur ${url}`);
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error(`EE : réponse trop volumineuse sur ${url}`);
  return text;
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const acceptLoss = process.argv.includes('--accept-loss');
  const [creditHtml, paymentHtml, pangaliitHtml] = await Promise.all([
    download(EE_CREDIT_PAGE),
    download(EE_PAYMENT_PAGE),
    download(EE_BIC_PAGE),
  ]);
  // Le jour de LECTURE : l'autorité date ses pages par leur dernière modification.
  const readOn = new Date().toISOString().slice(0, 10);
  const { register, notes } = buildEeRegister({ creditHtml, paymentHtml, pangaliitHtml, readOn });
  for (const note of notes) console.log(`note : ${note}`);
  console.log(
    `Finantsinspektsioon : ${register.entries.length} codes (${register.entries.filter((e) => e.bic).length} avec BIC), pages modifiées le ${register.pages.credit_institutions.edited} et le ${register.pages.payment_institutions.edited}, lues le ${register.read_on}`,
  );
  if (check) {
    const file = eeRegisterPath();
    if (!existsSync(file)) throw new Error(`EE : aucun fichier à comparer (${file})`);
    const previous = eeRegisterSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    const changes = diffEeRegisters(previous, register);
    for (const change of changes) console.log(`différence : ${change}`);
    console.log(
      changes.length === 0 ? 'Le fichier privé est à jour.' : 'Le fichier privé est périmé.',
    );
    process.exitCode = changes.length === 0 ? 0 : 1;
    return;
  }
  const file = eeRegisterPath();
  writeEeRegister(file, register, { acceptLoss });
  console.log(`Écrit : ${file}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
