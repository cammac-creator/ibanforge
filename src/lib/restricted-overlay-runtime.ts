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
 * ## Jamais de plantage, et jamais une surcouche qui marchait éteinte
 *
 * Surcouche absente, illisible ou refusée : la base publique est servie seule, et
 * l'API dit « non consulté » là où la famille manque (PR 249). Mais une
 * surcouche ACCEPTÉE est gardée à côté du fichier privé
 * (`restricted-<base>.accepted.sqlite`) : un fichier refusé déposé par-dessus ne
 * l'éteint ni pendant que le processus tourne (le rechargement est refusé), ni
 * au redémarrage suivant (la copie acceptée est reprise, fusionnée avec la base
 * publique FRAÎCHE). Un nouveau fichier qui cesserait de servir un membre que la
 * surcouche courante servait est refusé de la même façon (relecture de la
 * PR 252, R2 et R3).
 *
 * La raison est gardée ici ; `src/lib/restricted-overlay-ops.ts` l'écrit au
 * journal et prévient par l'alerte d'exploitation. Ce module n'importe ni
 * l'alerte ni les bases : elles s'inscrivent auprès de lui, ce qui évite un cycle
 * d'imports au démarrage.
 */
import { existsSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { OVERLAY_ENV, type OverlayKind } from './restricted-family.js';
import {
  acceptedCopyPath,
  buildMergedDatabase,
  discardFrozenCopy,
  errorCode,
  nextMergedPath,
  promoteAcceptedCopy,
  removeFileWithCompanions,
  removeStaleMerged,
  type MemberReport,
  type MergeState,
} from './restricted-overlay.js';

export type OverlayState = 'off' | MergeState;

interface FileSignature {
  mtimeMs: number;
  size: number;
  ino: number;
}

export interface OverlayStatus {
  kind: OverlayKind;
  /**
   * `off` : pas de variable. `applied` / `kept_public` / `partial` : une surcouche
   * acceptée est servie (voir MergeState). `refused` : base publique seule, voir
   * `error`.
   */
  state: OverlayState;
  overlay_path: string | null;
  /** Le fichier que la connexion ouvre : fusionné, ou la base publique. */
  served_path: string;
  public_path: string;
  /** Empreinte SHA-256 de la surcouche SERVIE (le fichier de la variable, ou la copie acceptée). */
  sha256: string | null;
  /** Pourquoi le fichier de la variable n'est pas servi (entier ou en partie). */
  error: string | null;
  members: MemberReport[];
  built_at: string | null;
  duration_ms: number | null;
  /** Signature du fichier de la variable au moment de la fusion. */
  file: FileSignature | null;
  /** Vrai quand la dernière surcouche acceptée est servie à la place du fichier refusé. */
  fallback: boolean;
  /** `last_refresh` de la copie servie, ramené à celui d'un membre servi par la surcouche. */
  lowered_last_refresh: string | null;
  /**
   * L'entretien des fichiers (copie acceptée, restes de fusion) a échoué : le code
   * seul, jamais un chemin. Ce qui est servi n'en dépend pas ; la protection de la
   * copie acceptée, si.
   */
  housekeeping_error: string | null;
}

export interface ReloadOutcome {
  kind: OverlayKind;
  /** Le fichier servi a changé (nouvelle surcouche, ou retour à la base publique). */
  changed: boolean;
  /** L'état servi APRÈS le rechargement. */
  status: OverlayStatus;
  /** Une surcouche nouvelle refusée : ce qui était servi continue de l'être. */
  rejected: OverlayStatus | null;
}

const statuses = new Map<OverlayKind, OverlayStatus>();
/**
 * Le dernier fichier VU par base (chemin de la variable et signature), qu'il ait
 * été accepté ou refusé. Distinct de `status.file` : sans lui, un fichier refusé
 * restait « changé » à chaque passage de la veille, et toutes les bases étaient
 * refusionnées toutes les dix minutes (relecture R1).
 */
const seen = new Map<OverlayKind, { overlayPath: string | null; file: FileSignature | null }>();
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

function validOverlayPath(path: string | null): path is string {
  return !!path && isAbsolute(path) && path.endsWith('.sqlite');
}

/** Une surcouche acceptée est servie (entière, en partie, ou gardée derrière un public plus récent). */
export function servesOverlay(state: OverlayState): boolean {
  return state === 'applied' || state === 'kept_public' || state === 'partial';
}

/** Membres non servis : un refus complet compte pire que tout refus partiel. */
function refusedCount(status: OverlayStatus): number {
  if (!servesOverlay(status.state)) return Number.POSITIVE_INFINITY;
  return status.members.filter((m) => m.state === 'refused').length;
}

/**
 * Construit l'état d'une base depuis le fichier de la variable, ou depuis
 * `source` (la copie acceptée), sans toucher à l'état courant. Ne jette jamais.
 */
function build(
  kind: OverlayKind,
  publicPath: string,
  source?: string,
): { status: OverlayStatus; frozen?: string } {
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
    fallback: false,
    lowered_last_refresh: null,
    housekeeping_error: null,
  };
  if (!overlayPath) return { status: base };
  // Signature d'abord, même pour un chemin refusé : la veille le reconnaîtra au
  // passage suivant au lieu de le reconstruire (R1).
  const file = signature(overlayPath);
  if (!validOverlayPath(overlayPath))
    return { status: { ...base, state: 'refused', error: 'overlay_path_invalid', file } };
  if (!source && !file)
    return { status: { ...base, state: 'refused', error: 'overlay_file_missing', file } };
  try {
    const result = buildMergedDatabase({
      kind,
      publicPath,
      overlayPath: source ?? overlayPath,
      outputPath: nextMergedPath(overlayPath),
      keepFrozen: !source,
    });
    return {
      status: {
        ...base,
        state: result.state,
        served_path: result.path ?? publicPath,
        sha256: result.sha256 ?? null,
        error: result.error ?? null,
        members: result.members,
        built_at: new Date().toISOString(),
        duration_ms: result.duration_ms,
        file,
        fallback: !!source,
        lowered_last_refresh: result.lowered_last_refresh ?? null,
      },
      frozen: result.frozen_path,
    };
  } catch (err) {
    return {
      status: {
        ...base,
        state: 'refused',
        error: `overlay_build_failed:${errorCode(err)}`,
        file,
      },
    };
  }
}

function recordSeen(status: OverlayStatus): void {
  seen.set(status.kind, { overlayPath: status.overlay_path, file: status.file });
}

/**
 * L'entretien des fichiers ne doit jamais interrompre un démarrage ni un
 * rechargement : l'état est enregistré AVANT, et un échec (dossier à la place de
 * la copie acceptée, volume plein…) est noté sur l'état, code seul. Sans cela,
 * une exception avant l'enregistrement faisait refusionner la base à chaque
 * ouverture de connexion, et une exception après la bascule sautait le vidage
 * des caches (relecture de la PR 252).
 */
function housekeep(status: OverlayStatus, work: () => void): void {
  try {
    work();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'erreur';
    status.housekeeping_error = code;
    console.error(`[surcouche] ${status.kind} : entretien des fichiers en échec (${code})`);
  }
}

/** Le fichier fusionné qu'un état a construit, s'il en a construit un. */
function dropMerged(status: OverlayStatus): void {
  if (status.served_path !== status.public_path) removeFileWithCompanions(status.served_path);
}

/** Pourquoi un état ne sert pas tout : l'erreur du fichier, ou ses membres refusés. */
function refusalReason(status: OverlayStatus): string {
  if (status.error) return status.error;
  const refused = status.members.filter((m) => m.state === 'refused');
  return refused.length > 0
    ? `members_refused:${refused.map((m) => `${m.id}=${m.reason ?? '?'}`).join(',')}`
    : 'unknown';
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
 *
 * Au démarrage, si le fichier de la variable est refusé (entier ou en partie) et
 * qu'une copie acceptée existe, celle-ci est fusionnée avec la base publique
 * fraîche ; la version qui sert le plus de membres l'emporte, le fichier de la
 * variable à égalité.
 */
export function servedDatabasePath(kind: OverlayKind, publicPath: string): string {
  const current = statuses.get(kind);
  if (
    current &&
    current.public_path === publicPath &&
    current.overlay_path === overlayPathFromEnv(kind)
  )
    return current.served_path;
  const built = build(kind, publicPath);
  let next = built.status;
  let frozen = built.frozen;
  recordSeen(next);
  if (
    validOverlayPath(next.overlay_path) &&
    (next.state === 'refused' || next.state === 'partial')
  ) {
    const accepted = acceptedCopyPath(next.overlay_path);
    if (existsSync(accepted)) {
      const alt = build(kind, publicPath, accepted).status;
      if (refusedCount(alt) < refusedCount(next)) {
        const refused = next;
        const refusedFrozen = frozen;
        frozen = undefined;
        next = {
          ...alt,
          error: `variable_file_refused:${refusalReason(refused)}`,
          file: refused.file,
        };
        housekeep(next, () => {
          dropMerged(refused);
          discardFrozenCopy(refusedFrozen);
        });
      } else housekeep(next, () => dropMerged(alt));
    }
  }
  statuses.set(kind, next);
  const served = next;
  housekeep(served, () => {
    if (frozen) {
      if (servesOverlay(served.state) && !served.fallback && validOverlayPath(served.overlay_path))
        promoteAcceptedCopy(frozen, acceptedCopyPath(served.overlay_path));
      else discardFrozenCopy(frozen);
    }
    // Restes d'un démarrage précédent ou d'un démarrage interrompu : ~36 Mo chacun.
    if (validOverlayPath(served.overlay_path))
      removeStaleMerged(served.overlay_path, servedMerged());
  });
  return served.served_path;
}

/** L'état de chaque base déjà ouverte (une base jamais ouverte n'a pas d'état). */
export function restrictedOverlayStatus(): OverlayStatus[] {
  return KINDS.flatMap((k) => {
    const s = statuses.get(k);
    return s ? [s] : [];
  });
}

export interface OverlayHealth {
  state: OverlayState | 'pending';
  sha256: string | null;
  /** Présent (et vrai) seulement quand la dernière surcouche acceptée est servie. */
  fallback?: true;
}

/** La forme courte, publique, pour /health : un état et une empreinte abrégée. */
export function restrictedOverlayHealth(): Record<OverlayKind, OverlayHealth> {
  const short = (k: OverlayKind): OverlayHealth => {
    const s = statuses.get(k);
    // Base pas encore ouverte : la fusion n'a pas eu lieu, ce n'est pas un refus.
    if (!s) return { state: overlayPathFromEnv(k) ? 'pending' : 'off', sha256: null };
    return {
      state: s.state,
      sha256: servesOverlay(s.state) ? (s.sha256?.slice(0, 12) ?? null) : null,
      ...(s.fallback ? { fallback: true as const } : {}),
    };
  };
  return { bic: short('bic'), compliance: short('compliance') };
}

/** Le fichier de la variable a-t-il changé depuis le dernier vu (remplacé, apparu, disparu) ? */
function overlayFileChanged(kind: OverlayKind): boolean {
  const last = seen.get(kind);
  if (!last) return false;
  const envPath = overlayPathFromEnv(kind);
  if (envPath !== last.overlayPath) return true;
  if (!envPath) return false;
  const now = signature(envPath);
  const before = last.file;
  if (!now || !before) return now !== before;
  return now.mtimeMs !== before.mtimeMs || now.size !== before.size || now.ino !== before.ino;
}

/**
 * Les bases ouvertes dont le fichier privé a changé depuis le dernier vu. Un
 * `stat` par base : assez léger pour une veille. Vide : rien à recharger.
 */
export function restrictedOverlaysChanged(): OverlayKind[] {
  return KINDS.filter((kind) => statuses.has(kind) && overlayFileChanged(kind));
}

/**
 * Recharge sans redémarrer les bases données (par défaut, celles dont le fichier
 * a changé) : mêmes contrôles qu'au démarrage, nouveau fichier fusionné au nom
 * neuf, puis bascule. Une base inchangée n'est jamais refusionnée (R5).
 *
 * - Nouvelle surcouche acceptée : l'état bascule, la connexion de la base est
 *   fermée par sa fermeture inscrite (la suivante s'ouvre sur le nouveau
 *   fichier), l'ancien fichier fusionné est effacé, les caches inscrits sont
 *   vidés, et la nouvelle devient la copie acceptée.
 * - Nouvelle surcouche refusée, ou qui cesserait de servir un membre que la
 *   courante servait : RIEN ne bascule, ce qui était servi l'est encore, et son
 *   fichier fusionné éventuel est effacé. Règle du tirage de l'étape suivante
 *   (PR 4) : un téléchargement raté ne retire jamais une surcouche qui marchait.
 * - Variable retirée : retour à la base publique seule.
 *
 * Synchrone de bout en bout : aucune requête ne peut s'intercaler entre la
 * fermeture et la bascule.
 */
export function reloadRestrictedOverlays(
  kinds: readonly OverlayKind[] = restrictedOverlaysChanged(),
): ReloadOutcome[] {
  const outcomes: ReloadOutcome[] = [];
  let anyChanged = false;
  for (const kind of KINDS) {
    if (!kinds.includes(kind)) continue;
    const current = statuses.get(kind);
    // Jamais ouverte : la prochaine ouverture construira avec la variable du moment.
    if (!current) continue;
    const { status: next, frozen } = build(kind, current.public_path);
    recordSeen(next);
    // Un membre servi aujourd'hui que le nouveau fichier refuse, ou ne porte plus
    // du tout (absent, voir `mayBeAbsent`) : une perte, on garde ce qui est servi.
    // Absent ne rend pas l'état « partiel » : la condition ne peut pas en dépendre.
    const lost =
      servesOverlay(current.state) &&
      current.members.some((m) => {
        if (m.state !== 'applied') return false;
        const after = next.members.find((n) => n.id === m.id)?.state;
        return after === 'refused' || after === 'absent';
      });
    if (!(servesOverlay(next.state) || next.state === 'off') || lost) {
      housekeep(next, () => {
        dropMerged(next);
        discardFrozenCopy(frozen);
      });
      outcomes.push({ kind, changed: false, status: current, rejected: next });
      continue;
    }
    if (next.state === 'off' && current.state === 'off') {
      outcomes.push({ kind, changed: false, status: current, rejected: null });
      continue;
    }
    statuses.set(kind, next);
    closers.get(kind)?.();
    anyChanged = true;
    housekeep(next, () => {
      if (frozen && validOverlayPath(next.overlay_path))
        promoteAcceptedCopy(frozen, acceptedCopyPath(next.overlay_path));
      else discardFrozenCopy(frozen);
      if (current.served_path !== current.public_path)
        removeFileWithCompanions(current.served_path);
      if (validOverlayPath(next.overlay_path)) removeStaleMerged(next.overlay_path, servedMerged());
    });
    outcomes.push({ kind, changed: true, status: next, rejected: null });
  }
  if (anyChanged) for (const reset of reloadHooks) reset();
  return outcomes;
}

const DECISION_LABEL: Record<string, string> = {
  public_empty: 'public vide',
  overlay_newer: 'surcouche plus récente',
  identical: 'identique au public',
};

/** Une ligne de journal, sans chemin complet ni contenu : l'état et ses membres. */
export function describeOverlayStatus(status: OverlayStatus): string {
  const head = `[surcouche] ${status.kind} : ${status.state}${status.fallback ? ' (dernière surcouche acceptée)' : ''}`;
  if (status.state === 'off') return `${head} (aucune variable ${OVERLAY_ENV[status.kind]})`;
  const sha = status.sha256 ? ` sha256=${status.sha256}` : '';
  const error = status.error ? ` erreur=${status.error}` : '';
  const lowered = status.lowered_last_refresh
    ? ` last_refresh servi=${status.lowered_last_refresh}`
    : '';
  const members = status.members
    .map((m) => {
      if (m.state === 'refused') return `${m.id}=refusé(${m.reason ?? '?'})`;
      if (m.state === 'absent') return `${m.id}=absent du fichier (non consulté)`;
      if (m.state === 'kept_public') return `${m.id}=public gardé (plus récent ou non daté)`;
      const why = m.decision ? `,${DECISION_LABEL[m.decision] ?? m.decision}` : '';
      return `${m.id}=${m.inserted ?? m.rows}${why}`;
    })
    .join(' ');
  const time = status.duration_ms !== null ? ` en ${status.duration_ms} ms` : '';
  return `${head}${sha}${error}${lowered}${time}${members ? ` — ${members}` : ''}`;
}

/** Réservé aux tests : oublie l'état, comme un redémarrage (les fichiers restent). */
export function resetRestrictedOverlayStateForTests(): void {
  statuses.clear();
  seen.clear();
}
