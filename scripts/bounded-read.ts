/**
 * Des lectures bornées pour les scripts qui téléchargent une source (relectures des
 * PR 638, 639 et 640, 18/11/2026).
 *
 * Deux choses, qu'aucun lecteur ne faisait en entier :
 *
 * - `readCappedBody` lit le corps d'une réponse en comptant les octets PENDANT la
 *   réception, et s'arrête au plafond. Un contrôle fait après `arrayBuffer()` ou
 *   `text()` empêche d'analyser un fichier trop gros, mais ne borne ni le
 *   téléchargement ni la mémoire.
 * - `measureXlsxArchive` mesure ce qu'une archive XLSX pèse une fois décompressée,
 *   AVANT que SheetJS ne la lise (il décompresse toutes les parties avant de lire une
 *   cellule), en lisant l'archive exactement comme SheetJS la lit.
 *
 * Aucune de ces fonctions n'écrit sur disque ni ne lance de requête.
 */
import { inflateRawSync } from 'node:zlib';

/** Un corps de réponse plus grand que son plafond : rien n'en est gardé. */
export class BodyTooLarge extends Error {}

/**
 * Le corps entier, ou `BodyTooLarge` dès que le plafond est franchi : la taille
 * annoncée est refusée avant toute lecture, et le flux est compté morceau par
 * morceau, puis annulé. `what` ouvre le message (« DK: https://… »). Le message ne
 * porte jamais « HTTP » suivi d'un code : `failureCause` le lirait comme un refus du
 * serveur, et le chargeur danois se replierait sur son adresse connue.
 */
export async function readCappedBody(
  res: Response,
  maxBytes: number,
  what: string,
): Promise<Buffer> {
  const tooLarge = () => new BodyTooLarge(`${what} is larger than ${maxBytes} bytes; refusing`);
  const declared = res.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!res.body) {
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > maxBytes) throw tooLarge();
    return body;
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

/** Une archive refusée avant SheetJS ; `reason` dit laquelle des bornes a joué. */
export class ArchiveRefused extends Error {
  constructor(
    message: string,
    readonly reason: 'unreadable' | 'too_many_parts' | 'too_large' | 'method',
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface XlsxLimits {
  /** Ce que toutes les parties peuvent peser, décompressées. */
  maxUnzippedBytes: number;
  /** Combien de parties l'archive peut compter. */
  maxParts: number;
}

const END_OF_DIRECTORY = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const CENTRAL_HEADER = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const ZIP64_EXTRA = 0x0001;

/** Le champ supplémentaire porte-t-il des tailles ZIP64 (en-tête 0x0001) ? */
function hasZip64Sizes(extra: Buffer): boolean {
  for (let i = 0; i + 4 <= extra.length;) {
    if (extra.readUInt16LE(i) === ZIP64_EXTRA) return true;
    i += 4 + extra.readUInt16LE(i + 2);
  }
  return false;
}

/**
 * Ce que SheetJS décompressera de cette archive, en octets ; lève `ArchiveRefused`
 * au-delà des bornes, ou sur une archive que la mesure et SheetJS ne liraient pas de
 * la même façon (relecture de la PR 640, sur `scripts/seed-national-dk.ts`).
 *
 * La mesure d'avant passait par `readZipEntries` (seed-eba-psd.ts), qui ne lit pas
 * l'archive comme `parse_zip` de SheetJS (xlsx.js, version tenue à la racine) :
 * - la fin du répertoire : SheetJS prend la DERNIÈRE signature du fichier, cherchée
 *   à partir de 4 octets avant la fin ; `readZipEntries` la dernière qui commence au
 *   moins 22 octets avant la fin. Une seconde signature dans les derniers octets
 *   faisait mesurer un répertoire et décompresser un autre ;
 * - le nombre de parties : SheetJS lit celui du disque courant (fin + 8),
 *   `readZipEntries` le total (fin + 10) ;
 * - la méthode de compression : SheetJS lit celle de l'en-tête LOCAL, la mesure
 *   lisait celle du répertoire central. Une partie annoncée « stockée » au centre et
 *   « comprimée » sur place était comptée à sa taille comprimée, puis décompressée
 *   sans borne par SheetJS.
 *
 * Ici chaque champ est lu là où SheetJS le lit, et ce qui pourrait différer est
 * refusé : une signature de fin dans les 21 derniers octets, deux comptes de parties
 * différents, des tailles ZIP64 (aucun classeur de cette taille n'en a besoin).
 * Une partie comprimée est décompressée par zlib, comme SheetJS le fait, depuis le
 * début de ses données jusqu'à la fin du flux, dans le budget qui reste. Une partie
 * stockée compte ce que SheetJS en découpe.
 */
export function measureXlsxArchive(buffer: Buffer, limits: XlsxLimits, label: string): number {
  const unreadable = (why: string, cause?: unknown) =>
    new ArchiveRefused(
      `${label}: not a readable XLSX archive (${why})`,
      'unreadable',
      cause === undefined ? undefined : { cause },
    );
  const at = (offset: number, size: number) => offset >= 0 && offset + size <= buffer.length;

  const end = buffer.lastIndexOf(END_OF_DIRECTORY);
  if (end < 0) throw unreadable('no end-of-central-directory record');
  if (!at(end, 22)) throw unreadable('an end-of-directory signature in its last bytes');
  const count = buffer.readUInt16LE(end + 8);
  if (count !== buffer.readUInt16LE(end + 10)) throw unreadable('two counts of parts');
  if (count > limits.maxParts)
    throw new ArchiveRefused(
      `${label}: the workbook holds more than ${limits.maxParts} parts; refusing`,
      'too_many_parts',
    );

  const tooLarge = () =>
    new ArchiveRefused(
      `${label}: the workbook expands to more than ${limits.maxUnzippedBytes} bytes; refusing`,
      'too_large',
    );
  let total = 0;
  let central = buffer.readUInt32LE(end + 16);
  for (let n = 0; n < count; n++) {
    if (!at(central, 46) || buffer.readUInt32LE(central) !== CENTRAL_HEADER)
      throw unreadable(`bad central directory header at ${central}`);
    const nameLen = buffer.readUInt16LE(central + 28);
    const extraLen = buffer.readUInt16LE(central + 30);
    const commentLen = buffer.readUInt16LE(central + 32);
    const local = buffer.readUInt32LE(central + 42);
    const extraAt = central + 46 + nameLen;
    if (!at(extraAt, extraLen)) throw unreadable('a central record runs past the end');
    if (hasZip64Sizes(buffer.subarray(extraAt, extraAt + extraLen)))
      throw unreadable('ZIP64 sizes');

    if (!at(local, 30) || buffer.readUInt32LE(local) !== LOCAL_HEADER)
      throw unreadable(`bad local file header at ${local}`);
    const method = buffer.readUInt16LE(local + 8);
    const storedSize = buffer.readUInt32LE(local + 18);
    const localNameLen = buffer.readUInt16LE(local + 26);
    const localExtraLen = buffer.readUInt16LE(local + 28);
    const localExtraAt = local + 30 + localNameLen;
    if (!at(localExtraAt, localExtraLen)) throw unreadable('a local header runs past the end');
    if (hasZip64Sizes(buffer.subarray(localExtraAt, localExtraAt + localExtraLen)))
      throw unreadable('ZIP64 sizes');
    const data = localExtraAt + localExtraLen;

    const remaining = limits.maxUnzippedBytes - total;
    if (method === 0) {
      total += Math.min(storedSize, buffer.length - data);
    } else if (method === 8) {
      try {
        total += inflateRawSync(buffer.subarray(data), {
          maxOutputLength: Math.max(1, remaining),
        }).length;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw tooLarge();
        throw unreadable(`a part could not be inflated: ${(e as Error).message}`, e);
      }
    } else {
      throw new ArchiveRefused(
        `${label}: a part of the workbook uses compression method ${method}`,
        'method',
      );
    }
    if (total > limits.maxUnzippedBytes) throw tooLarge();
    central += 46 + nameLen + extraLen + commentLen;
  }
  return total;
}
