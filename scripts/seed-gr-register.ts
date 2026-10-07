/**
 * Import PRIVÉ de l'index HEBIC de la Hellenic Bank Association (HBA).
 *
 *   GR_REGISTER_PATH=/chemin/absolu/hors-depot/gr-register.json npx tsx scripts/seed-gr-register.ts
 *
 * Écrit un fichier JSON privé, jamais data/bic.sqlite ni un export public : la
 * permission de la HBA (08/09/2026) porte sur les réponses de l'API, comme celle
 * de l'ABBL (scripts/seed-lu-register.ts, le modèle de ce script). Le script
 * refuse un chemin relatif et un chemin situé dans un dépôt git.
 *
 * Seul le fichier des BANQUES est lu : le code bancaire (positions 5 à 7 de
 * l'IBAN) est ce que le verdict dit ; le fichier des agences est un inventaire
 * de points de présence qui ne doit jamais devenir une raison de refuser.
 *
 * Quatre pièges, mesurés le 09/09/2026 et encore vrais le 07/10/2026 :
 * - le CSV est en Windows-1253, servi en application/octet-stream sans charset ;
 * - une ligne de TITRE précède l'en-tête : l'en-tête se trouve par « Κωδικός » ;
 * - les codes portent des apostrophes d'Excel ('011') ;
 * - la page écrit le trimestre avec un B LATIN (« Έκδοση 2026 B' τρίμηνο »),
 *   homoglyphe du Β grec : les deux alphabets sont acceptés.
 *
 * La HBA ne date pas ses éditions : le fichier garde l'édition que la page nomme
 * et le jour de lecture, séparément, sans jamais en faire une date de publication.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  GR_PUBLICATION,
  GR_SOURCE,
  grRegisterSchema,
  type GrRegister,
} from '../src/lib/gr-register.js';

/** Le fichier des banques, à adresse stable (mesuré le 09/09 et le 07/10/2026). */
export const GR_BANKS_CSV = 'https://www.hba.gr/info/hebicmap/downloadbanks';

/** 35 établissements dans l'édition 2026 T2 : un fichier bien plus court est un téléchargement tronqué. */
const MIN_ENTRIES = 25;

const QUARTER_LETTERS: Record<string, 1 | 2 | 3 | 4> = {
  Α: 1,
  A: 1,
  Β: 2,
  B: 2,
  Γ: 3,
  G: 3,
  Δ: 4,
  D: 4,
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * L'édition que la page nomme, « 2026 Q2 ». Une page qui n'en nomme plus est
 * REFUSÉE : l'édition est la moitié datée du crédit, et aucune horloge ne la
 * remplace.
 */
export function parseGrPage(html: string): string {
  const text = decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const m = /Έκδοση\s+(\d{4})\s+([ΑΒΓΔABGD])\s*['’′]?\s*τρίμηνο/u.exec(text);
  const quarter = m ? QUARTER_LETTERS[m[2]!] : undefined;
  if (!m || !quarter) {
    throw new Error("GR : la page HEBIC ne nomme plus d'édition (« Έκδοση AAAA X' τρίμηνο »)");
  }
  return `${m[1]} Q${quarter}`;
}

/**
 * « ΑΙΟΛΟΥ 86, 102 32 ΑΘΗΝΑ » : rue, code postal, ville. Le code postal sert
 * d'ancre (« 102 32 », « 15231 », « 45 221 ») ; une ligne que le motif ne
 * reconnaît pas est gardée entière comme rue, jamais devinée.
 */
const GR_ADDRESS = /^(.*?)\s*,\s*(\d{3}\s?\d{2}|\d{2}\s\d{3})(?!\d)\s*,?\s*(.+?)\s*$/;

export function parseGrBanks(text: string): GrRegister['entries'] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  // Pas de `\b` : la frontière de mot de JavaScript ne connaît que l'ASCII.
  const headerIdx = lines.findIndex((l) => /^\s*(Κωδικός|Code)(?=[\s;,]|$)/iu.test(l));
  if (headerIdx < 0) throw new Error('GR : aucune ligne d’en-tête ne commence par « Κωδικός »');
  const header = lines[headerIdx]!.split(';').map((h) => h.trim());
  if (header.length < 3) throw new Error('GR : le séparateur n’est plus « ; »');
  const iCode = header.findIndex((h) => /Κωδικός|Code/iu.test(h));
  const iName = header.findIndex((h) => /Όνομα|Name/iu.test(h));
  const iAddr = header.findIndex((h) => /Διεύθυνση|Address/iu.test(h));
  if (iCode < 0 || iName < 0 || iAddr < 0) {
    throw new Error('GR : colonne code, nom ou adresse absente de l’en-tête');
  }
  const seen = new Map<string, GrRegister['entries'][number]>();
  for (const line of lines.slice(headerIdx + 1)) {
    const f = line.split(';');
    const digits = (f[iCode] ?? '').replace(/['’"]/g, '').trim();
    if (!/^\d{1,3}$/.test(digits)) continue;
    const code = digits.padStart(3, '0');
    const name = (f[iName] ?? '').trim();
    if (!name || seen.has(code)) continue;
    const address = (f[iAddr] ?? '').trim();
    const parts = address ? GR_ADDRESS.exec(address) : null;
    seen.set(code, {
      code,
      name,
      street: parts ? parts[1]!.trim() || null : address || null,
      post_code: parts ? parts[2]!.replace(/\s/g, '') : null,
      town: parts ? parts[3]!.trim() : null,
    });
  }
  return [...seen.values()];
}

/** Le fichier privé complet, à partir des octets du CSV de la HBA. */
export function buildGrRegister(csv: Buffer, edition: string, readOn: string): GrRegister {
  // Windows-1253 quoi que dise l'en-tête HTTP (aucun charset n'y figure).
  const entries = parseGrBanks(new TextDecoder('windows-1253').decode(csv));
  if (entries.length < MIN_ENTRIES) {
    throw new Error(
      `GR : ${entries.length} établissements, en dessous du plancher de ${MIN_ENTRIES}`,
    );
  }
  return grRegisterSchema.parse({
    schema: 1,
    source: GR_SOURCE,
    publication: GR_PUBLICATION,
    edition,
    read_on: readOn,
    sha256: createHash('sha256').update(csv).digest('hex'),
    entries,
  });
}

/** Le dossier git qui contient ce chemin, ou null. */
function enclosingRepository(path: string): string | null {
  let dir = dirname(path);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function writeGrRegister(path: string, register: GrRegister): void {
  if (!isAbsolute(path) || !path.endsWith('.json')) {
    throw new Error('Chemin JSON privé absolu requis');
  }
  const repository = enclosingRepository(path);
  if (repository) {
    throw new Error(`Refus : ${path} est dans un dépôt git (${repository}), HEBIC n'y entre pas`);
  }
  const checked = grRegisterSchema.parse(register);
  if (existsSync(path)) {
    const previous = grRegisterSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    if (
      checked.edition < previous.edition ||
      checked.entries.length < previous.entries.length * 0.9
    ) {
      throw new Error('Recul d’édition ou forte baisse du registre : contrôle manuel requis');
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
  if (!response.ok) throw new Error(`HBA : HTTP ${response.status} sur ${url}`);
  if (!response.body) throw new Error('Réponse HBA vide');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maximum) throw new Error('Réponse HBA trop volumineuse');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  const path = process.env.GR_REGISTER_PATH;
  if (!path)
    throw new Error('GR_REGISTER_PATH doit désigner un fichier privé hors du dépôt public');
  const edition = parseGrPage((await download(GR_PUBLICATION, 2_000_000)).toString('utf8'));
  const csv = await download(GR_BANKS_CSV, 1_000_000);
  // Le jour de LECTURE : la HBA ne date rien, et le crédit le dit « read on ».
  const readOn = new Date().toISOString().slice(0, 10);
  const register = buildGrRegister(csv, edition, readOn);
  writeGrRegister(path, register);
  console.log(
    `HEBIC : ${register.entries.length} codes, édition ${register.edition}, lue le ${register.read_on}, SHA-256 ${register.sha256}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
