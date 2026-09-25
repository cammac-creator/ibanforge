/**
 * Le manifeste d'une release de la surcouche privée.
 *
 * ## Pourquoi ce fichier existe
 *
 * Étape 5 de la sortie des données (décision de Claude-Alain du 24/09/2026,
 * point 6 : un dépôt privé pour les données retirées). Un dépôt GitHub privé
 * reconstruit la surcouche chaque semaine (conformité) et chaque mois (BIC),
 * sans rien commiter, et la publie en release : les fichiers de surcouche et ce
 * manifeste. L'API ne reçoit rien et n'expose aucun point d'écriture : elle tire
 * la dernière release (src/lib/restricted-overlay-pull.ts). Le manifeste est ce
 * qu'elle lit AVANT de télécharger quoi que ce soit : l'empreinte et la taille
 * de chaque fichier, sa date de génération, le commit du code public qui l'a
 * produit, et les lignes de chaque membre de la famille.
 *
 * Le format est écrit ICI, une fois, pour les deux côtés : le dépôt privé
 * l'écrit par `npm run overlay -- manifest` (scripts/restricted-overlay.ts),
 * l'API le relit par `parseManifest`. Aucune dépendance au-delà de
 * restricted-overlay.ts : le script l'importe sans ouvrir aucune base de l'API.
 *
 * ## La porte de qualité
 *
 * `compareManifests` refuse une release qui perdrait un fichier ou un membre
 * présent dans la précédente, ou dont un membre d'au moins
 * SHRINK_GUARD_MIN_ROWS lignes baisserait de plus de 10 %. Elle compare les
 * MANIFESTES, pas les fichiers : une surcouche précédente d'une autre version de
 * format (refusée par le chargeur d'aujourd'hui) ne la désarme pas.
 *
 * ## Les membres repris (depuis le 25/09/2026)
 *
 * Quand la source d'un membre est en panne au passage mensuel, ce membre est
 * repris tel quel de la surcouche précédente (scripts/restricted-carry-over.ts)
 * et le fichier le dit dans ses métadonnées. Le manifeste le recopie, champ
 * `carried_over` de l'entrée du fichier : `{ "<membre>": { "source_date",
 * "cause" } }`, absent quand rien n'est repris. Il est relu DEPUIS LE FICHIER à
 * chaque manifeste, y compris quand le passage hebdomadaire reprend le fichier
 * BIC tel quel : l'information suit le fichier tant qu'il est servi. Un lecteur
 * plus ancien ignore ce champ.
 */
import { basename } from 'node:path';
import type { OverlayKind } from './restricted-family.js';
import {
  SHRINK_GUARD_MIN_ROWS,
  carriedOverFromMeta,
  inspectOverlay,
  memberRefused,
  parseCarriedOver,
  type CarriedOverMember,
} from './restricted-overlay.js';

/** Version du format. Une autre valeur est refusée, jamais devinée. */
export const MANIFEST_FORMAT = 1;
/** Le nom de l'asset du manifeste dans chaque release. */
export const MANIFEST_FILE_NAME = 'manifest.json';
/** Un manifeste fait un ou deux Ko : au-delà, ce n'en est pas un. */
export const MANIFEST_MAX_BYTES = 64 * 1024;
/**
 * Plafond d'un fichier de surcouche téléchargé par l'API. Chaque surcouche fait
 * quelques centaines de Ko : la marge est large, le plafond reste un plafond.
 */
export const OVERLAY_DOWNLOAD_MAX_BYTES = 32 * 1024 * 1024;

const KINDS: readonly OverlayKind[] = ['bic', 'compliance'];
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;
const FILE_NAME = /^[a-z0-9][a-z0-9._-]{0,99}\.sqlite$/;
const MEMBER_ID = /^[a-z0-9_]{1,64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** Un fichier de surcouche décrit par le manifeste. */
export interface ManifestFile {
  /** Le nom de l'asset dans la release. */
  name: string;
  sha256: string;
  bytes: number;
  /** Date de création écrite dans la surcouche par l'extraction (`overlay_meta.created_at`). */
  generated_at: string;
  /** Le commit du code public qui a produit ce fichier. */
  public_commit: string | null;
  /** Les lignes de chaque membre de la famille, telles que le chargeur les compte. */
  members: Record<string, number>;
  /** Les membres repris de la surcouche précédente (voir l'en-tête) ; absent si aucun. */
  carried_over?: Record<string, CarriedOverMember>;
}

export interface OverlayManifest {
  format: typeof MANIFEST_FORMAT;
  /** Quand ce manifeste (donc la release) a été écrit. */
  generated_at: string;
  /** Le commit du code public de ce passage. */
  public_commit: string | null;
  /**
   * Un fichier par base. Un passage n'en reconstruit qu'une ; l'autre est
   * reprise telle quelle de la release précédente, avec son entrée.
   */
  files: Partial<Record<OverlayKind, ManifestFile>>;
}

export type ManifestParse = { ok: true; manifest: OverlayManifest } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Un instant ISO 8601 en UTC, tel que `toISOString()` l'écrit, ou null. */
function instant(value: unknown): string | null {
  return typeof value === 'string' && INSTANT.test(value) && !Number.isNaN(Date.parse(value))
    ? value
    : null;
}

function commitOf(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && COMMIT.test(value) ? value : undefined;
}

function parseFile(value: unknown): ManifestFile | null {
  if (!isRecord(value)) return null;
  const { name, sha256, bytes, members } = value;
  if (typeof name !== 'string' || !FILE_NAME.test(name)) return null;
  if (typeof sha256 !== 'string' || !SHA256.test(sha256)) return null;
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0) return null;
  const generatedAt = instant(value.generated_at);
  if (!generatedAt) return null;
  const commit = commitOf(value.public_commit);
  if (commit === undefined) return null;
  if (!isRecord(members)) return null;
  const counts: Record<string, number> = {};
  for (const [id, rows] of Object.entries(members)) {
    if (!MEMBER_ID.test(id)) return null;
    if (typeof rows !== 'number' || !Number.isSafeInteger(rows) || rows < 0) return null;
    counts[id] = rows;
  }
  // Facultatif ; s'il est là, chaque membre repris est un membre du fichier.
  let carried: Record<string, CarriedOverMember> | null = null;
  if (value.carried_over !== undefined) {
    carried = parseCarriedOver(value.carried_over);
    if (!carried || Object.keys(carried).some((id) => !Object.hasOwn(counts, id))) return null;
  }
  return {
    name,
    sha256,
    bytes,
    generated_at: generatedAt,
    public_commit: commit,
    members: counts,
    ...(carried && Object.keys(carried).length > 0 ? { carried_over: carried } : {}),
  };
}

/**
 * Relit un manifeste, champ par champ. Toute valeur inattendue le fait refuser
 * entier, avec un code court (jamais le texte lu) : l'API n'en téléchargera rien.
 */
export function parseManifest(text: string): ManifestParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'manifest_not_json' };
  }
  if (!isRecord(raw)) return { ok: false, error: 'manifest_not_object' };
  if (raw.format !== MANIFEST_FORMAT) return { ok: false, error: 'manifest_format' };
  const generatedAt = instant(raw.generated_at);
  if (!generatedAt) return { ok: false, error: 'manifest_generated_at' };
  const commit = commitOf(raw.public_commit);
  if (commit === undefined) return { ok: false, error: 'manifest_public_commit' };
  if (!isRecord(raw.files)) return { ok: false, error: 'manifest_files' };
  const files: OverlayManifest['files'] = {};
  for (const [key, value] of Object.entries(raw.files)) {
    const kind = KINDS.find((k) => k === key);
    if (!kind) return { ok: false, error: 'manifest_unknown_kind' };
    const file = parseFile(value);
    if (!file) return { ok: false, error: `manifest_file_invalid:${kind}` };
    files[kind] = file;
  }
  return {
    ok: true,
    manifest: { format: MANIFEST_FORMAT, generated_at: generatedAt, public_commit: commit, files },
  };
}

/**
 * L'entrée du manifeste pour une surcouche : contrôlée exactement comme le
 * chargeur de l'API la contrôlera (`inspectOverlay`, chaque membre accepté),
 * sinon refusée. Un fichier identique à celui de la release précédente (même
 * empreinte : la base que ce passage ne reconstruit pas) garde sa date de
 * génération et son commit.
 */
export function manifestEntryFor(options: {
  kind: OverlayKind;
  path: string;
  publicCommit: string | null;
  previous?: ManifestFile;
}): ManifestFile {
  const { kind, path } = options;
  const inspection = inspectOverlay(path, kind);
  const refused = inspection.members.filter(memberRefused);
  if (!inspection.ok || refused.length > 0)
    throw new Error(
      `Surcouche ${kind} refusée par le contrôle du chargeur : ` +
        (inspection.error ?? refused.map((m) => `${m.id}=${m.reason ?? '?'}`).join(', ')),
    );
  const sha256 = inspection.sha256 as string;
  const bytes = inspection.bytes as number;
  // Un membre absent (venu après la première surcouche, que ce fichier ne porte
  // pas) n'est pas listé : la release suivante qui le porte ne sera pas lue comme
  // une hausse depuis zéro, et une release qui le perdrait après l'avoir porté
  // est refusée (`lost_member`).
  const members = Object.fromEntries(
    inspection.members.filter((m) => m.state !== 'absent').map((m) => [m.id, m.rows]),
  );
  const name = basename(path);
  // Toujours relu du fichier, même inchangé : un fichier BIC repris par le passage
  // hebdomadaire garde la liste de ses membres repris.
  let carriedOver: Record<string, CarriedOverMember>;
  try {
    carriedOver = carriedOverFromMeta(inspection.meta);
  } catch {
    throw new Error(`Surcouche ${kind} : liste des membres repris illisible`);
  }
  // Seuls les membres de la famille d'aujourd'hui : un membre sorti de la famille
  // depuis l'écriture du fichier ferait refuser le manifeste entier par le lecteur.
  carriedOver = Object.fromEntries(
    Object.entries(carriedOver).filter(([id]) => Object.hasOwn(members, id)),
  );
  const carried = Object.keys(carriedOver).length > 0 ? { carried_over: carriedOver } : {};
  if (options.previous && options.previous.sha256 === sha256) {
    const kept: ManifestFile = { ...options.previous, name, bytes, members };
    delete kept.carried_over;
    return { ...kept, ...carried };
  }
  const generatedAt = instant(inspection.meta?.created_at);
  if (!generatedAt) throw new Error(`Surcouche ${kind} sans date de création lisible`);
  return {
    name,
    sha256,
    bytes,
    generated_at: generatedAt,
    public_commit: options.publicCommit,
    members,
    ...carried,
  };
}

/**
 * La porte de qualité d'une release face à la précédente. Vide : rien à dire.
 * Sinon, un code par problème :
 * - `lost_file:<base>` : la précédente portait cette base, la nouvelle non ;
 * - `lost_member:<base>:<membre>` : un membre a disparu du fichier ;
 * - `shrunk:<base>:<membre>:<avant>-><après>` : baisse de plus de 10 % d'un
 *   membre d'au moins SHRINK_GUARD_MIN_ROWS lignes (même règle que l'extraction).
 *
 * `allowShrink` (contrôle manuel, relance à la main) laisse passer les baisses
 * et les membres sortis de la famille par une modification du code, jamais un
 * fichier perdu.
 */
export function compareManifests(
  previous: OverlayManifest,
  next: OverlayManifest,
  options: { allowShrink?: boolean } = {},
): string[] {
  const problems: string[] = [];
  for (const kind of KINDS) {
    const before = previous.files[kind];
    if (!before) continue;
    const after = next.files[kind];
    if (!after) {
      problems.push(`lost_file:${kind}`);
      continue;
    }
    if (options.allowShrink) continue;
    for (const [id, rows] of Object.entries(before.members)) {
      const now = after.members[id];
      if (now === undefined) problems.push(`lost_member:${kind}:${id}`);
      else if (rows >= SHRINK_GUARD_MIN_ROWS && now < rows * 0.9)
        problems.push(`shrunk:${kind}:${id}:${rows}->${now}`);
    }
  }
  return problems;
}
