/**
 * Relecture du registre monténégrin : le tableau « Banking identification codes in
 * the RTGS system » de la Banque centrale du Monténégro (CBCG).
 *
 *   npx tsx scripts/seed-me-register.ts            # écrit le fichier PRIVÉ
 *   npx tsx scripts/seed-me-register.ts --check    # compare, n'écrit rien (sortie 1 si ça diffère)
 *
 * Le fichier est PRIVÉ : `ME_REGISTER_PATH` si la variable est posée, sinon
 * docs/internal/registres-ee-me-2026-10-08/me-register.json (dossier ignoré par
 * git). Le script refuse un chemin qu'un dépôt git suivrait : la permission de la
 * banque centrale porte sur les réponses de l'API, la table entière n'entre pas
 * dans le dépôt public (scripts/private-register-path.ts).
 *
 * La page (adresse dans src/lib/me-register.ts) donne pour chaque banque un nom, un
 * BIC et un « fixed no. » de trois chiffres, qui sont les positions 5 à 7 de
 * l'IBAN. Elle ne porte aucune date : le fichier garde le jour de lecture.
 *
 * Le tableau est retrouvé par son titre, puis ses quatre en-têtes sont vérifiés : la
 * même page porte, juste au-dessus, un tableau des « participants » à trois colonnes
 * qui a lui aussi un « Fixed no. » mais aucun BIC, et qu'on ne lit pas. Une page qui
 * change de forme (titre ou en-tête absents, code ou BIC illisible, doublon) fait
 * ÉCHOUER le script. Les noms sont gardés tels que publiés. La CBCG a écrit que la
 * mise à jour est de notre responsabilité : `--check` sert à la vérifier sans rien
 * toucher.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ME_PUBLICATION,
  ME_SOURCE,
  meRegisterSchema,
  type MeRegister,
} from '../src/lib/me-register.js';
import { cellText, parseHtmlTables } from './html-tables.js';
import { assertPrivateRegisterPath, privateRegisterPath } from './private-register-path.js';

/** Le fichier PRIVÉ : `ME_REGISTER_PATH`, sinon le dossier ignoré par git. */
export const meRegisterPath = (): string =>
  privateRegisterPath('ME_REGISTER_PATH', 'me-register.json');

export const ME_HEADING = 'Banking identification codes in the RTGS system';

/** Mesuré le 08/10/2026 : 12 banques. Un tableau bien plus court est une lecture tronquée. */
export const ME_MIN_ENTRIES = 8;

const ME_HEADERS = ['No.', 'Bank', 'BIC code', 'Fixed no.'];

export function parseMeBanks(
  html: string,
  /** Le plancher de banques ; les essais sur fragments réduits le baissent. */
  minEntries: number = ME_MIN_ENTRIES,
): MeRegister['entries'] {
  const at = html.indexOf(ME_HEADING);
  if (at < 0) throw new Error(`ME : le titre « ${ME_HEADING} » a disparu de la page`);
  const table = parseHtmlTables(html.slice(at))[0];
  const header = table?.rows[0];
  if (
    !table ||
    !header?.header ||
    header.cells.map((cell) => cellText(cell)).join('|') !== ME_HEADERS.join('|')
  ) {
    throw new Error(
      `ME : le tableau sous « ${ME_HEADING} » n'a plus les colonnes ${ME_HEADERS.join(', ')}`,
    );
  }
  const entries: MeRegister['entries'] = [];
  const seen = new Set<string>();
  for (const row of table.rows.slice(1)) {
    const name = cellText(row.cells[1]);
    const bic = cellText(row.cells[2]).replace(/\s+/g, '');
    const code = cellText(row.cells[3]).replace(/\s+/g, '');
    if (name === '' && bic === '' && code === '') continue;
    if (!/^\d{3}$/.test(code)) throw new Error(`ME : code illisible « ${code} » (${name})`);
    if (!/^[A-Z]{4}ME[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(bic)) {
      throw new Error(`ME : BIC illisible « ${bic} » (${name})`);
    }
    if (name === '') throw new Error(`ME : le code ${code} n'a pas de nom`);
    if (seen.has(code)) throw new Error(`ME : code ${code} listé deux fois`);
    seen.add(code);
    entries.push({ code, name, bic });
  }
  if (entries.length < minEntries) {
    throw new Error(`ME : ${entries.length} banques, en dessous du plancher de ${minEntries}`);
  }
  return entries;
}

export function buildMeRegister(
  html: string,
  readOn: string,
  minEntries: number = ME_MIN_ENTRIES,
): MeRegister {
  return meRegisterSchema.parse({
    schema: 1,
    source: ME_SOURCE,
    publication: ME_PUBLICATION,
    read_on: readOn,
    entries: parseMeBanks(html, minEntries),
  });
}

/** Le fichier tel qu'il s'écrit : l'en-tête déployé, une banque par ligne (un diff lisible). */
export function formatMeRegister(register: MeRegister): string {
  const { entries, ...head } = register;
  const headText = JSON.stringify(head, null, 2).slice(0, -2);
  const rows = entries.map((entry) => `    ${JSON.stringify(entry)}`).join(',\n');
  return `${headText},\n  "entries": [\n${rows}\n  ]\n}\n`;
}

/** Ce qui change entre deux éditions, hors le jour de lecture. Vide : rien à écrire. */
export function diffMeRegisters(previous: MeRegister, next: MeRegister): string[] {
  const out: string[] = [];
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
export function writeMeRegister(
  path: string,
  register: MeRegister,
  options: { acceptLoss?: boolean } = {},
): void {
  assertPrivateRegisterPath(path);
  const checked = meRegisterSchema.parse(register);
  if (existsSync(path)) {
    const previous = meRegisterSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    if (checked.read_on < previous.read_on) {
      throw new Error('ME : le jour de lecture recule, contrôle manuel requis');
    }
    const lost = previous.entries.filter(
      (entry) => !checked.entries.some((fresh) => fresh.code === entry.code),
    );
    if (lost.length > 0 && !options.acceptLoss) {
      throw new Error(
        `ME : ${lost.length} code(s) disparaissent (${lost.map((entry) => entry.code).join(', ')}) : contrôle manuel requis, puis --accept-loss`,
      );
    }
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, formatMeRegister(checked), { mode: 0o600, flag: 'wx' });
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
  if (!response.ok) throw new Error(`ME : HTTP ${response.status} sur ${url}`);
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error('ME : réponse trop volumineuse');
  return text;
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const acceptLoss = process.argv.includes('--accept-loss');
  const html = await download(ME_PUBLICATION);
  // Le jour de LECTURE : la CBCG ne date pas cette page.
  const readOn = new Date().toISOString().slice(0, 10);
  const register = buildMeRegister(html, readOn);
  console.log(`CBCG : ${register.entries.length} banques, page lue le ${register.read_on}`);
  if (check) {
    const file = meRegisterPath();
    if (!existsSync(file)) throw new Error(`ME : aucun fichier à comparer (${file})`);
    const previous = meRegisterSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    const changes = diffMeRegisters(previous, register);
    for (const change of changes) console.log(`différence : ${change}`);
    console.log(
      changes.length === 0 ? 'Le fichier privé est à jour.' : 'Le fichier privé est périmé.',
    );
    process.exitCode = changes.length === 0 ? 0 : 1;
    return;
  }
  const file = meRegisterPath();
  writeMeRegister(file, register, { acceptLoss });
  console.log(`Écrit : ${file}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
