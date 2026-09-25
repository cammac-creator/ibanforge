/**
 * La surcouche privée dans le processus : quel fichier chaque base ouvre, dans
 * quel état, et comment en changer sans redémarrer.
 *
 * `getBicDB()` (src/lib/db.ts) et `getComplianceDB()` (src/lib/compliance-db.ts)
 * demandent ici, à l'ouverture, le chemin à ouvrir. Sans variable, c'est la base
 * publique, exactement comme avant. Avec `RESTRICTED_BIC_OVERLAY_PATH` ou
 * `RESTRICTED_COMPLIANCE_OVERLAY_PATH`, c'est une copie fusionnée construite à
 * côté du fichier privé (src/lib/restricted-overlay.ts).
 *
 * ## Jamais de plantage
 *
 * Surcouche absente, illisible ou refusée : la base publique est servie seule, et
 * l'API dit « non consulté » là où la famille manque (PR 249). La raison est
 * gardée ici ; `src/index.ts` l'écrit au journal et prévient par l'alerte
 * d'exploitation. Ce module n'importe ni l'alerte ni les bases : elles
 * s'inscrivent auprès de lui, ce qui évite un cycle d'imports au démarrage.
 */
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { OVERLAY_ENV, type OverlayKind } from './restricted-family.js';
import {
  buildMergedDatabase,
  nextMergedPath,
  removeStaleMerged,
  type MemberReport,
} from './restricted-overlay.js';

export type OverlayState = 'off' | 'applied' | 'partial' | 'refused';

interface FileSignature {
  mtimeMs: number;
  size: number;
  ino: number;
}

export interface OverlayStatus {
  kind: OverlayKind;
  /** `off` : pas de variable. `refused` : base publique seule, voir `error`. */
  state: OverlayState;
  overlay_path: string | null;
  /** Le fichier que la connexion ouvre : fusionné, ou la base publique. */
  served_path: string;
  public_path: string;
  /** Empreinte SHA-256 de la surcouche servie (du fichier lu, pas de la fusion). */
  sha256: string | null;
  error: string | null;
  members: MemberReport[];
  built_at: string | null;
  duration_ms: number | null;
  /** Signature du fichier privé au moment de la fusion, pour voir un remplacement. */
  file: FileSignature | null;
}

export interface ReloadOutcome {
  kind: OverlayKind;
  /** Le fichier servi a changé (nouvelle surcouche, ou retour à la base publique). */
  changed: boolean;
  /** L'état servi APRÈS le rechargement. */
  status: OverlayStatus;
  /** Une surcouche nouvelle refusée : la précédente continue d'être servie. */
  rejected: OverlayStatus | null;
}

const statuses = new Map<OverlayKind, OverlayStatus>();
const closers = new Map<OverlayKind, () => void>();
const reloadHooks = new Set<() => void>();

const KINDS: readonly OverlayKind[] = ['bic', 'compliance'];

/**
 * Une base s'inscrit avec sa fermeture : celle-ci ferme la connexion ET efface
 * tout ce qui a été préparé ou mémorisé sur elle (requêtes, mémos de tables).
 * Jamais `closeAll()`, qui fermerait aussi la base des clés et des crédits sous
 * les requêtes en cours.
 */
export function registerReferenceCloser(kind: OverlayKind, close: () => void): void {
  closers.set(kind, close);
}

/**
 * Un cache dérivé des données de référence (comptes de /llms.txt, faits du jeu
 * de données) s'inscrit ici pour être vidé après un rechargement.
 */
export function onReferenceDataReload(reset: () => void): void {
  reloadHooks.add(reset);
}

function signature(path: string): FileSignature | null {
  try {
    const s = statSync(path);
    return { mtimeMs: s.mtimeMs, size: s.size, ino: s.ino };
  } catch {
    return null;
  }
}

function overlayPathFromEnv(kind: OverlayKind): string | null {
  return process.env[OVERLAY_ENV[kind]] || null;
}

/** Construit l'état d'une base, sans toucher à l'état courant. Ne jette jamais. */
function build(kind: OverlayKind, publicPath: string): OverlayStatus {
  const overlayPath = overlayPathFromEnv(kind);
  const base: OverlayStatus = {
    kind,
    state: 'off',
    overlay_path: overlayPath,
    served_path: publicPath,
    public_path: publicPath,
    sha256: null,
    error: null,
    members: [],
    built_at: null,
    duration_ms: null,
    file: null,
  };
  if (!overlayPath) return base;
  if (!isAbsolute(overlayPath) || !overlayPath.endsWith('.sqlite'))
    return { ...base, state: 'refused', error: 'overlay_path_invalid' };
  const file = signature(overlayPath);
  if (!file) return { ...base, state: 'refused', error: 'overlay_file_missing' };
  try {
    const result = buildMergedDatabase({
      kind,
      publicPath,
      overlayPath,
      outputPath: nextMergedPath(overlayPath),
    });
    return {
      ...base,
      state: result.state,
      served_path: result.path ?? publicPath,
      sha256: result.sha256 ?? null,
      error: result.error ?? null,
      members: result.members,
      built_at: new Date().toISOString(),
      duration_ms: result.duration_ms,
      file,
    };
  } catch (err) {
    return {
      ...base,
      state: 'refused',
      error: `overlay_build_failed:${err instanceof Error ? err.message : String(err)}`,
      file,
    };
  }
}

/** Les fichiers fusionnés que l'état courant sert : jamais effacés. */
function servedMerged(): Set<string> {
  return new Set(
    [...statuses.values()].filter((s) => s.served_path !== s.public_path).map((s) => s.served_path),
  );
}

/**
 * Le chemin qu'une base doit ouvrir. Appelé à l'ouverture de la connexion : la
 * fusion a lieu une fois par processus (et par rechargement), jamais par requête.
 */
export function servedDatabasePath(kind: OverlayKind, publicPath: string): string {
  const current = statuses.get(kind);
  if (
    current &&
    current.public_path === publicPath &&
    current.overlay_path === overlayPathFromEnv(kind)
  )
    return current.served_path;
  const next = build(kind, publicPath);
  statuses.set(kind, next);
  // Restes d'un démarrage précédent ou d'un démarrage interrompu : ~36 Mo chacun.
  if (next.overlay_path) removeStaleMerged(next.overlay_path, servedMerged());
  return next.served_path;
}

/** L'état de chaque base déjà ouverte (une base jamais ouverte n'a pas d'état). */
export function restrictedOverlayStatus(): OverlayStatus[] {
  return KINDS.flatMap((k) => {
    const s = statuses.get(k);
    return s ? [s] : [];
  });
}

/** La forme courte, publique, pour /health : un état et une empreinte abrégée. */
export function restrictedOverlayHealth(): Record<
  OverlayKind,
  { state: OverlayState | 'pending'; sha256: string | null }
> {
  const short = (k: OverlayKind): { state: OverlayState | 'pending'; sha256: string | null } => {
    const s = statuses.get(k);
    // Base pas encore ouverte : la fusion n'a pas eu lieu, ce n'est pas un refus.
    if (!s) return { state: overlayPathFromEnv(k) ? 'pending' : 'off', sha256: null };
    return {
      state: s.state,
      sha256:
        s.state === 'applied' || s.state === 'partial' ? (s.sha256?.slice(0, 12) ?? null) : null,
    };
  };
  return { bic: short('bic'), compliance: short('compliance') };
}

/**
 * Le fichier privé a-t-il changé depuis la dernière fusion (remplacé, apparu,
 * disparu, variable modifiée) ? Un `stat` par base : assez léger pour une veille.
 */
export function restrictedOverlayFilesChanged(): boolean {
  return KINDS.some((kind) => {
    const current = statuses.get(kind);
    if (!current) return false;
    const envPath = overlayPathFromEnv(kind);
    if (envPath !== current.overlay_path) return true;
    if (!envPath) return false;
    const now = signature(envPath);
    const before = current.file;
    if (!now || !before) return now !== before;
    return now.mtimeMs !== before.mtimeMs || now.size !== before.size || now.ino !== before.ino;
  });
}

/**
 * Recharge les surcouches sans redémarrer : mêmes contrôles qu'au démarrage,
 * nouveau fichier fusionné au nom neuf, puis bascule.
 *
 * - Nouvelle surcouche acceptée (entière ou en partie) : l'état bascule, la
 *   connexion de la base est fermée par sa fermeture inscrite (la suivante
 *   s'ouvre sur le nouveau fichier), l'ancien fichier fusionné est effacé, les
 *   caches inscrits sont vidés.
 * - Nouvelle surcouche refusée : RIEN ne bascule, la précédente reste servie.
 *   C'est la règle du tirage de l'étape suivante (PR 4) : un téléchargement raté
 *   ne retire jamais une surcouche qui marchait.
 * - Variable retirée : retour à la base publique seule.
 *
 * Synchrone de bout en bout : aucune requête ne peut s'intercaler entre la
 * fermeture et la bascule. Coût mesuré dans la description de la PR (copie de la
 * base et fusion, quelques centaines de millisecondes sur la base BIC).
 */
export function reloadRestrictedOverlays(): ReloadOutcome[] {
  const outcomes: ReloadOutcome[] = [];
  let anyChanged = false;
  for (const kind of KINDS) {
    const current = statuses.get(kind);
    // Jamais ouverte : la prochaine ouverture construira avec la variable du moment.
    if (!current) continue;
    const next = build(kind, current.public_path);
    const usable = next.state === 'applied' || next.state === 'partial' || next.state === 'off';
    if (!usable) {
      outcomes.push({ kind, changed: false, status: current, rejected: next });
      continue;
    }
    if (next.state === 'off' && current.state === 'off') {
      outcomes.push({ kind, changed: false, status: current, rejected: null });
      continue;
    }
    statuses.set(kind, next);
    closers.get(kind)?.();
    const previous = current.served_path !== current.public_path ? current.overlay_path : null;
    if (previous) removeStaleMerged(previous, servedMerged());
    anyChanged = true;
    outcomes.push({ kind, changed: true, status: next, rejected: null });
  }
  if (anyChanged) for (const reset of reloadHooks) reset();
  return outcomes;
}

/** Une ligne de journal, sans chemin complet ni contenu : l'état et ses membres. */
export function describeOverlayStatus(status: OverlayStatus): string {
  const head = `[surcouche] ${status.kind} : ${status.state}`;
  if (status.state === 'off') return `${head} (aucune variable ${OVERLAY_ENV[status.kind]})`;
  const sha = status.sha256 ? ` sha256=${status.sha256}` : '';
  const error = status.error ? ` erreur=${status.error}` : '';
  const members = status.members
    .map((m) => {
      if (m.state !== 'applied') return `${m.id}=refusé(${m.reason ?? '?'})`;
      const twin =
        m.identical_to_public === true
          ? ',identique au public'
          : m.identical_to_public === false
            ? ',DIFFÉRENT du public'
            : '';
      return `${m.id}=${m.inserted ?? m.rows}${twin}`;
    })
    .join(' ');
  const time = status.duration_ms !== null ? ` en ${status.duration_ms} ms` : '';
  return `${head}${sha}${error}${time}${members ? ` — ${members}` : ''}`;
}

/** Réservé aux tests : oublie l'état (les fichiers fusionnés restent à effacer). */
export function resetRestrictedOverlayStateForTests(): void {
  statuses.clear();
}
