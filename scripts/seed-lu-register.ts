/** Import privé ABBL : aucune copie du registre dans bic.sqlite ou les exports publics. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as XLSX from 'xlsx';
import {
  LU_PUBLICATION,
  LU_SOURCE,
  luRegisterSchema,
  type LuRegister,
} from '../src/lib/lu-register.js';

export function parseLuPublication(html: string): { url: string; published: string } {
  const links = [...html.matchAll(/href=["']([^"']+\.xlsx(?:\?[^"']*)?)["']/gi)]
    .map((match) => new URL(match[1].replaceAll('&amp;', '&'), LU_PUBLICATION))
    .filter(
      (url) =>
        url.protocol === 'https:' &&
        url.hostname === 'office-membernet.abbl.lu' &&
        /ABBL_LuxembourgRegisterofIBANBICCodes/i.test(url.pathname),
    );
  const urls = [...new Set(links.map((url) => url.href))];
  const match = html.match(/Published\s+on\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const month = match ? months.indexOf(match[2]) + 1 : 0;
  if (urls.length !== 1 || !match || !month)
    throw new Error('Publication ABBL ambiguë ou non datée');
  const published = `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  if (new Date(`${published}T00:00:00Z`).toISOString().slice(0, 10) !== published)
    throw new Error('Date ABBL invalide');
  return { url: urls[0], published };
}

export function parseLuWorkbook(bytes: Buffer, published: string): LuRegister {
  const workbook = XLSX.read(bytes, { type: 'buffer' });
  if (workbook.SheetNames.length !== 1 || workbook.SheetNames[0] !== 'Organizations') {
    throw new Error('Structure du classeur ABBL inconnue');
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Organizations, {
    header: 1,
    defval: null,
  });
  const header = rows.findIndex(
    (row) =>
      row.map((v) => String(v ?? '').trim()).join('|') === 'Credit institution|IBAN Code|BICCode',
  );
  if (header < 0) throw new Error('En-têtes ABBL manquants');
  const entries = rows
    .slice(header + 1)
    .filter((row) => row.some((cell) => cell !== null && cell !== ''))
    .map((row) => {
      const raw = String(row[1] ?? '').trim();
      if (!/^\d{1,3}$/.test(raw) || row.length !== 3) throw new Error('Ligne ABBL non reconnue');
      return {
        code: raw.padStart(3, '0'),
        name: String(row[0] ?? '').trim(),
        bic: String(row[2] ?? '').trim(),
      };
    });
  // Une page tronquée ne doit pas remplacer silencieusement une édition entière.
  if (entries.length < 100) throw new Error('Registre ABBL incomplet : import abandonné');
  return luRegisterSchema.parse({
    schema: 1,
    source: LU_SOURCE,
    publication: LU_PUBLICATION,
    published,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    entries,
  });
}

export function writeLuRegister(path: string, register: LuRegister): void {
  if (!isAbsolute(path) || !path.endsWith('.json'))
    throw new Error('Chemin JSON privé absolu requis');
  const checked = luRegisterSchema.parse(register);
  if (existsSync(path)) {
    const previous = luRegisterSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    if (
      checked.published < previous.published ||
      checked.entries.length < previous.entries.length * 0.9
    ) {
      throw new Error('Recul de date ou forte baisse du registre : contrôle manuel requis');
    }
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(checked), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

async function download(url: string, maximum: number): Promise<Buffer> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
    headers: { 'User-Agent': 'IBANforge/1.0 (+https://ibanforge.com)' },
  });
  if (!response.ok) throw new Error(`ABBL : HTTP ${response.status}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (!response.body) throw new Error('Réponse ABBL vide');
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maximum) throw new Error('Réponse ABBL trop volumineuse');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  const path = process.env.LU_REGISTER_PATH;
  if (!path)
    throw new Error('LU_REGISTER_PATH doit désigner un fichier privé hors du dépôt public');
  const publication = parseLuPublication(
    (await download(LU_PUBLICATION, 2_000_000)).toString('utf8'),
  );
  const register = parseLuWorkbook(
    await download(publication.url, 2_000_000),
    publication.published,
  );
  writeLuRegister(path, register);
  console.log(
    `ABBL : ${register.entries.length} codes importés, publication ${register.published}, SHA-256 ${register.sha256}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
