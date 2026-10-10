/**
 * Relecture du registre serbe : la liste PDF des banques qui participent aux systèmes
 * RTGS et de compensation de la Banque nationale de Serbie (NBS).
 *
 *   npx tsx scripts/seed-rs-register.ts            # écrit le fichier PRIVÉ
 *   npx tsx scripts/seed-rs-register.ts --check    # compare, n'écrit rien (sortie 1 si ça diffère)
 *
 * Le fichier est PRIVÉ : `RS_REGISTER_PATH` si la variable est posée, sinon
 * docs/internal/registres-ee-me-2026-10-08/rs-register.json (dossier ignoré par git).
 * Le script refuse un chemin qu'un dépôt git suivrait : la permission de la NBS
 * (09/10/2026) porte sur les réponses de l'API, la table entière n'entre pas dans le
 * dépôt public (scripts/private-register-path.ts).
 *
 * Le document (adresse dans src/lib/rs-register.ts) est un PDF de deux pages. Le
 * texte en est extrait par `pdftotext -raw` (poppler : `brew install poppler`), aucune
 * bibliothèque PDF n'étant ajoutée aux dépendances. Le texte extrait donne, par ligne :
 * un numéro, le nom (qui peut couler sur plusieurs lignes), le compte à la NBS
 * (908-AAAAA-CC), le numéro d'entreprise (matični broj) et le BIC. Il n'y a pas de
 * colonne « code » : le code NBS à trois caractères, c'est-à-dire les positions 5 à 7
 * de l'IBAN serbe, est le début à trois chiffres du groupe central du compte
 * (105 pour 908-10501-97), ce que confirme la liste de la compensation internationale
 * de la NBS (banks_in_int_po.pdf, colonne ID).
 *
 * Contrôles qui font ÉCHOUER le script plutôt que de deviner : titre ou date du
 * document absents, une ligne que l'analyse ne reconnaît pas (le nombre de comptes
 * « 908 – … » doit égaler celui des lignes lues), une clé de contrôle ISO 7064 mod 97-10
 * fausse sur un compte, un code en double, un matični broj illisible, un plancher non
 * atteint. Euroclear (BIC belge) participe mais n'émet pas d'IBAN serbe : il est écarté,
 * et le script le dit. Une baisse du nombre de codes est refusée sans `--accept-loss`.
 */
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  RS_PUBLICATION,
  RS_SOURCE,
  rsRegisterSchema,
  type RsRegister,
} from '../src/lib/rs-register.js';
import { assertPrivateRegisterPath, privateRegisterPath } from './private-register-path.js';

/** Le fichier PRIVÉ : `RS_REGISTER_PATH`, sinon le dossier ignoré par git. */
export const rsRegisterPath = (): string =>
  privateRegisterPath('RS_REGISTER_PATH', 'rs-register.json');

/** Mesuré le 10/10/2026 : 19 banques serbes (et Euroclear, écarté). Un résultat bien plus court est une lecture tronquée. */
export const RS_MIN_ENTRIES = 15;

export interface NbsRow {
  n: number;
  name: string;
  /** Les cinq chiffres du groupe central du compte à la NBS. */
  account: string;
  code: string;
  registration_number: string;
  bic: string;
}

/** La clé de contrôle ISO 7064 mod 97-10 d'un compte serbe : 908, treize chiffres, deux de clé. */
export function nbsAccountCheck(group: string): string {
  const base = BigInt(`908${group.padStart(13, '0')}00`);
  return String(98n - (base % 97n)).padStart(2, '0');
}

const TITLE =
  /ACCOUNT NUMBERS AND BANK IDENTIFICATION CODES OF PARTICIPANTS\s+IN THE NBS RTGS AND CLEARING SYSTEM\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/;

const ROW =
  /(\d{1,2})\.\s+(.+?)\s+908\s*[–-]\s*(\d{5})\s*[–-]\s*(\d{2})\s+(\d{8}|\d{4}\.\d{3}\.\d{3})\s+([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)(?![A-Z0-9])/g;

/** La date du document, « 1/9/2026 » (jour/mois/année) devient 2026-09-01. */
export function parseNbsDate(text: string): string {
  const match = TITLE.exec(text);
  if (!match)
    throw new Error('RS : titre ou date du document introuvables (« 1/9/2026 » sous le titre)');
  const iso = `${match[3]}-${match[2]!.padStart(2, '0')}-${match[1]!.padStart(2, '0')}`;
  if (new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso) {
    throw new Error(`RS : date du document invalide (${match[0].split(/\s/).pop()})`);
  }
  return iso;
}

/** Les lignes du tableau, dans l'ordre du document, noms coulés sur plusieurs lignes recollés. */
export function parseNbsRows(text: string): NbsRow[] {
  const flat = text.replace(/\s+/g, ' ');
  const rows: NbsRow[] = [];
  for (const match of flat.matchAll(ROW)) {
    const [, n, rawName, account, check, registration, bic] = match;
    const name = rawName!.trim();
    if (/908\s*[–-]/.test(name)) throw new Error(`RS : deux comptes dans une même ligne (${name})`);
    if (nbsAccountCheck(account!) !== check) {
      throw new Error(
        `RS : clé de contrôle fausse sur le compte 908-${account}-${check} (${name})`,
      );
    }
    rows.push({
      n: Number(n),
      name,
      account: account!,
      code: account!.slice(0, 3),
      registration_number: registration!,
      bic: bic!,
    });
  }
  // Chaque compte « 908 – … » du texte doit être une ligne lue : une ligne que le motif
  // saute serait avalée dans le nom de la suivante, ou perdue.
  const accounts = flat.match(/908\s*[–-]\s*\d{5}\s*[–-]\s*\d{2}/g) ?? [];
  if (accounts.length !== rows.length) {
    throw new Error(`RS : ${accounts.length} comptes dans le texte, ${rows.length} lignes lues`);
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.n <= rows[i - 1]!.n)
      throw new Error(`RS : numérotation hors ordre à la ligne ${rows[i]!.n}`);
  }
  return rows;
}

export interface RsBuild {
  register: RsRegister;
  /** Ce qui n'a pas été importé, pour le journal du script. */
  notes: string[];
}

/** Le fichier complet, à partir du texte extrait du PDF. */
export function buildRsRegister(
  text: string,
  readOn: string,
  minEntries: number = RS_MIN_ENTRIES,
): RsBuild {
  const published = parseNbsDate(text);
  const notes: string[] = [];
  const entries: RsRegister['entries'] = [];
  const seen = new Set<string>();
  for (const row of parseNbsRows(text)) {
    // Un participant dont le BIC n'est pas serbe n'émet pas d'IBAN serbe.
    if (row.bic.slice(4, 6) !== 'RS') {
      notes.push(
        `ligne ${row.n} : « ${row.name} » (BIC ${row.bic}) n'a pas de BIC serbe, non importée`,
      );
      continue;
    }
    if (!/^\d{8}$/.test(row.registration_number)) {
      throw new Error(`RS : matični broj illisible « ${row.registration_number} » (${row.name})`);
    }
    if (seen.has(row.code)) throw new Error(`RS : code ${row.code} listé deux fois`);
    seen.add(row.code);
    entries.push({
      code: row.code,
      name: row.name,
      bic: row.bic,
      registration_number: row.registration_number,
    });
  }
  if (entries.length < minEntries) {
    throw new Error(`RS : ${entries.length} banques, en dessous du plancher de ${minEntries}`);
  }
  const register = rsRegisterSchema.parse({
    schema: 1,
    source: RS_SOURCE,
    publication: RS_PUBLICATION,
    published,
    read_on: readOn,
    entries,
  });
  return { register, notes };
}

/** Le texte du PDF par `pdftotext -raw` (poppler). Échoue clairement si l'outil manque. */
export function extractPdfText(pdf: Buffer): string {
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error("RS : la réponse n'est pas un PDF (la NBS a peut-être déplacé le document)");
  }
  const dir = mkdtempSync(join(tmpdir(), 'ibf-rs-pdf-'));
  try {
    const file = join(dir, 'nbs.pdf');
    writeFileSync(file, pdf, { mode: 0o600 });
    const run = spawnSync('pdftotext', ['-raw', '-enc', 'UTF-8', file, '-'], {
      encoding: 'utf8',
      maxBuffer: 5_000_000,
    });
    if (run.error) {
      throw new Error(
        `RS : pdftotext (poppler) est requis pour lire le PDF : brew install poppler (${run.error.message})`,
      );
    }
    if (run.status !== 0)
      throw new Error(`RS : pdftotext a échoué (code ${run.status}) : ${run.stderr.trim()}`);
    return run.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Le fichier tel qu'il s'écrit : l'en-tête déployé, une banque par ligne (un diff lisible). */
export function formatRsRegister(register: RsRegister): string {
  const { entries, ...head } = register;
  const headText = JSON.stringify(head, null, 2).slice(0, -2);
  const rows = entries.map((entry) => `    ${JSON.stringify(entry)}`).join(',\n');
  return `${headText},\n  "entries": [\n${rows}\n  ]\n}\n`;
}

/** Ce qui change entre deux éditions, hors le jour de lecture. Vide : rien à écrire. */
export function diffRsRegisters(previous: RsRegister, next: RsRegister): string[] {
  const out: string[] = [];
  if (previous.published !== next.published) {
    out.push(`document daté du ${previous.published}, maintenant du ${next.published}`);
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

/** Écrit le fichier, atomiquement, après avoir refusé un recul de date ou une disparition de codes. */
export function writeRsRegister(
  path: string,
  register: RsRegister,
  options: { acceptLoss?: boolean } = {},
): void {
  assertPrivateRegisterPath(path);
  const checked = rsRegisterSchema.parse(register);
  if (existsSync(path)) {
    const previous = rsRegisterSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    if (checked.published < previous.published || checked.read_on < previous.read_on) {
      throw new Error(
        'RS : la date du document ou le jour de lecture recule, contrôle manuel requis',
      );
    }
    const lost = previous.entries.filter(
      (entry) => !checked.entries.some((fresh) => fresh.code === entry.code),
    );
    if (lost.length > 0 && !options.acceptLoss) {
      throw new Error(
        `RS : ${lost.length} code(s) disparaissent (${lost.map((entry) => entry.code).join(', ')}) : contrôle manuel requis, puis --accept-loss`,
      );
    }
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, formatRsRegister(checked), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
    headers: { 'User-Agent': 'IBANforge/1.0 (+https://ibanforge.com)' },
  });
  if (!response.ok) throw new Error(`RS : HTTP ${response.status} sur ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 2_000_000) throw new Error('RS : réponse trop volumineuse');
  return bytes;
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const acceptLoss = process.argv.includes('--accept-loss');
  const text = extractPdfText(await download(RS_PUBLICATION));
  // Le jour de LECTURE ; la date de publication est celle que le document porte.
  const readOn = new Date().toISOString().slice(0, 10);
  const { register, notes } = buildRsRegister(text, readOn);
  for (const note of notes) console.log(`note : ${note}`);
  console.log(
    `NBS : ${register.entries.length} banques, document daté du ${register.published}, lu le ${register.read_on}`,
  );
  if (check) {
    const file = rsRegisterPath();
    if (!existsSync(file)) throw new Error(`RS : aucun fichier à comparer (${file})`);
    const previous = rsRegisterSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    const changes = diffRsRegisters(previous, register);
    for (const change of changes) console.log(`différence : ${change}`);
    console.log(
      changes.length === 0 ? 'Le fichier privé est à jour.' : 'Le fichier privé est périmé.',
    );
    process.exitCode = changes.length === 0 ? 0 : 1;
    return;
  }
  const file = rsRegisterPath();
  writeRsRegister(file, register, { acceptLoss });
  console.log(`Écrit : ${file}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
