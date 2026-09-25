/**
 * Le tirage de la surcouche privée par l'API (sortie des données, étape 5).
 *
 * ## Pourquoi ce fichier existe
 *
 * Décision de Claude-Alain du 24/09/2026 (point 6) : les données retirées du
 * dépôt public vivent dans un dépôt privé. Ce dépôt reconstruit la surcouche
 * chaque semaine (conformité) et chaque mois (BIC), ne commite aucune donnée, et
 * la publie en release avec son manifeste (src/lib/restricted-overlay-manifest.ts).
 * L'API la TIRE : aucun point d'écriture n'est exposé, et le seul secret est un
 * jeton GitHub en lecture seule sur ce seul dépôt.
 *
 * ## Inerte sans ses variables
 *
 * `RESTRICTED_OVERLAY_PULL_REPO` (owner/name) et `RESTRICTED_OVERLAY_PULL_TOKEN`.
 * Toutes deux absentes : aucun appel réseau, aucune alerte, et `/health` dit
 * `restricted_overlays.pull: { state: 'off' }`. Le nom du dépôt privé ne vit que
 * dans la variable.
 *
 * ## Un tirage
 *
 * Dernière release, puis son manifeste, puis, pour chaque base dont la variable
 * RESTRICTED_*_OVERLAY_PATH est posée (sans elle, rien pour cette base) :
 * - rien si l'empreinte annoncée est celle du fichier servi, du fichier en place
 *   ou de la copie acceptée, ni si ce même fichier a déjà été refusé ;
 * - sinon téléchargement plafonné, empreinte et taille vérifiées, puis
 *   `inspectOverlay` (les contrôles du chargeur : chaque membre doit y être
 *   accepté, sinon la surcouche servie perdrait un membre), et enfin écriture
 *   d'un voisin renommé de façon atomique sur le fichier de la variable.
 * La veille (src/lib/restricted-overlay-ops.ts) recharge aussitôt la base
 * remplacée, avec son journal et ses alertes, et garde ce qu'elle sert si la
 * fusion refuse le fichier. Tout échec laisse en place ce qui est servi.
 *
 * ## Cadence
 *
 * Accroché à la veille de dix minutes : jamais au démarrage, jamais bloquant.
 * Un tirage toutes les quatre heures, plus une gigue d'au plus trente minutes ;
 * une heure après un échec. L'état survit aux redémarrages dans `kv_state`
 * (stats.sqlite, sur le volume) : un redéploiement ne relance rien, et un
 * fichier déjà en place n'est jamais retéléchargé.
 *
 * ## Alertes (src/lib/ops-alert.ts), refermées seules
 *
 * - `overlay:pull` : aucun tirage réussi depuis plus de 24 h alors que les
 *   variables sont posées (jeton expiré ou révoqué, dépôt inaccessible, fichier
 *   refusé à chaque tirage).
 * - `overlay:pull:stale` : la dernière release a plus de 9 jours, ou le fichier
 *   qu'elle porte pour une base est plus vieux que 9 jours (conformité) ou
 *   35 jours (BIC), ou absent : un workflow du dépôt privé s'est arrêté. Le
 *   fichier BIC est reporté de release en release par le workflow hebdomadaire :
 *   sans son âge propre, un workflow mensuel mort passerait inaperçu.
 *
 * ## Jamais un secret ni le nom du dépôt
 *
 * Ni dans le journal, ni dans /health, ni dans `kv_state`, ni dans une alerte :
 * des codes d'erreur courts, jamais le message d'une exception (celui de fetch
 * porte l'adresse, donc le nom du dépôt). L'adresse signée vers laquelle GitHub
 * redirige un téléchargement n'est jamais écrite, et le jeton ne la suit pas.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { kvGet, kvSet } from './forum-radar-server.js';
import { opsFail, opsOk } from './ops-alert.js';
import { OVERLAY_ENV, type OverlayKind } from './restricted-family.js';
import {
  acceptedCopyPath,
  inspectOverlay,
  removeFileWithCompanions,
  sha256File,
} from './restricted-overlay.js';
import {
  MANIFEST_FILE_NAME,
  MANIFEST_MAX_BYTES,
  OVERLAY_DOWNLOAD_MAX_BYTES,
  parseManifest,
  type ManifestFile,
  type OverlayManifest,
} from './restricted-overlay-manifest.js';
import { restrictedOverlayStatus, servesOverlay } from './restricted-overlay-runtime.js';

/** Les deux variables du tirage : toutes deux absentes, rien ne se passe. */
export const PULL_ENV = {
  repo: 'RESTRICTED_OVERLAY_PULL_REPO',
  token: 'RESTRICTED_OVERLAY_PULL_TOKEN',
} as const;

const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'ibanforge-overlay-pull';
const KINDS: readonly OverlayKind[] = ['bic', 'compliance'];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Entre deux tirages réussis, plus une gigue d'au plus PULL_JITTER_MS. */
export const PULL_INTERVAL_MS = 4 * HOUR;
const PULL_JITTER_MS = 30 * 60_000;
/** Après un échec, plus une gigue d'au plus RETRY_JITTER_MS. */
export const PULL_RETRY_MS = HOUR;
const RETRY_JITTER_MS = 10 * 60_000;
/** Sans tirage réussi depuis ce délai, variables posées : alerte `overlay:pull`. */
export const PULL_NO_SUCCESS_ALERT_MS = DAY;
/** Au-delà, la dernière release trahit un workflow privé arrêté. */
export const RELEASE_MAX_AGE_DAYS = 9;
/** Âge maximal du fichier de chaque base : une semaine ou un mois, plus une marge franche. */
export const FILE_MAX_AGE_DAYS: Readonly<Record<OverlayKind, number>> = {
  bic: 35,
  compliance: 9,
};
const API_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const RELEASE_MAX_BYTES = 1024 * 1024;
const KV_STATE = 'overlay:pull:state';
export const PULL_ALERT = 'overlay:pull';
export const PULL_STALE_ALERT = 'overlay:pull:stale';
/** Les voisins en cours d'écriture, à côté du fichier de la variable. */
const NEIGHBOUR_INFIX = '.pull-';
const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const TOKEN_PATTERN = /^[\x21-\x7e]{1,255}$/;
const TAG_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const ERROR_MAX = 200;
const DELIVERED_MAX = 8;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

type PullConfig =
  | { status: 'off' }
  | { status: 'error'; error: string }
  | {
      status: 'on';
      repo: string;
      token: string;
      /** Le fichier de chaque base dont la variable est posée ; null : chemin invalide. */
      targets: Partial<Record<OverlayKind, string | null>>;
    };

function readPullConfig(): PullConfig {
  const repo = (process.env[PULL_ENV.repo] ?? '').trim();
  const token = (process.env[PULL_ENV.token] ?? '').trim();
  if (!repo && !token) return { status: 'off' };
  if (!repo || !token) return { status: 'error', error: 'pull_config_incomplete' };
  if (!REPO_PATTERN.test(repo)) return { status: 'error', error: 'pull_repo_invalid' };
  if (!TOKEN_PATTERN.test(token)) return { status: 'error', error: 'pull_token_invalid' };
  const targets: Partial<Record<OverlayKind, string | null>> = {};
  for (const kind of KINDS) {
    const path = process.env[OVERLAY_ENV[kind]];
    if (!path) continue;
    // La même règle que le chargeur (restricted-overlay-runtime.ts).
    targets[kind] = isAbsolute(path) && path.endsWith('.sqlite') ? path : null;
  }
  if (Object.keys(targets).length === 0) return { status: 'error', error: 'pull_no_overlay_path' };
  return { status: 'on', repo, token, targets };
}

// ---------------------------------------------------------------------------
// État, gardé dans kv_state : jamais un secret, jamais le nom du dépôt
// ---------------------------------------------------------------------------

/** Un fichier livré par une release et posé sur le fichier de la variable. */
interface DeliveredFile {
  kind: OverlayKind;
  sha256: string;
  release: string;
  generated_at: string;
  public_commit: string | null;
}

interface PullState {
  /** Le tirage a été configuré : retirer les variables referme alors ses alertes. */
  configured: boolean;
  last_attempt_at: string | null;
  last_success_at: string | null;
  /** Début de la série d'échecs en cours, null après un succès. */
  failing_since: string | null;
  next_due_at: string | null;
  /** Code court du dernier échec, null après un succès. */
  error: string | null;
  /** La dernière release lue. */
  release: { tag: string; published_at: string | null } | null;
  /** Les derniers fichiers posés, pour dire d'où vient la surcouche servie. */
  delivered: DeliveredFile[];
  /** Le dernier fichier refusé de chaque base : jamais retéléchargé. */
  rejected: Partial<Record<OverlayKind, { sha256: string; error: string }>>;
  /** Ce qui était trop ancien à la dernière lecture de la release. */
  stale: string[];
}

function emptyState(): PullState {
  return {
    configured: false,
    last_attempt_at: null,
    last_success_at: null,
    failing_since: null,
    next_due_at: null,
    error: null,
    release: null,
    delivered: [],
    rejected: {},
    stale: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Relit l'état gardé, champ par champ : un état abîmé repart de zéro sans rien casser. */
function reviveState(raw: unknown): PullState {
  const state = emptyState();
  if (!isRecord(raw)) return state;
  state.configured = raw.configured === true;
  state.last_attempt_at = textOrNull(raw.last_attempt_at);
  state.last_success_at = textOrNull(raw.last_success_at);
  state.failing_since = textOrNull(raw.failing_since);
  state.next_due_at = textOrNull(raw.next_due_at);
  state.error = textOrNull(raw.error);
  if (isRecord(raw.release) && typeof raw.release.tag === 'string')
    state.release = { tag: raw.release.tag, published_at: textOrNull(raw.release.published_at) };
  if (Array.isArray(raw.delivered))
    state.delivered = raw.delivered.filter(
      (d): d is DeliveredFile =>
        isRecord(d) &&
        (d.kind === 'bic' || d.kind === 'compliance') &&
        typeof d.sha256 === 'string' &&
        typeof d.release === 'string' &&
        typeof d.generated_at === 'string',
    );
  if (isRecord(raw.rejected))
    for (const kind of KINDS) {
      const r = raw.rejected[kind];
      if (isRecord(r) && typeof r.sha256 === 'string' && typeof r.error === 'string')
        state.rejected[kind] = { sha256: r.sha256, error: r.error };
    }
  if (Array.isArray(raw.stale))
    state.stale = raw.stale.filter((s): s is string => typeof s === 'string');
  return state;
}

let memory: PullState | null = null;

/** L'état en mémoire ; relu de `kv_state` une fois par processus. */
function loadState(): PullState {
  if (memory) return memory;
  let restored = emptyState();
  try {
    const raw = kvGet(KV_STATE);
    if (raw) restored = reviveState(JSON.parse(raw));
  } catch {
    /* état illisible : on repart de zéro, ce qui est servi n'en dépend pas */
  }
  memory = restored;
  return memory;
}

function saveState(state: PullState): void {
  memory = state;
  try {
    kvSet(KV_STATE, JSON.stringify(state));
  } catch (err) {
    console.error(`[surcouche] tirage : état non enregistré (${codeOf(err)})`);
  }
}

// ---------------------------------------------------------------------------
// Codes d'erreur : courts, sans message d'exception, sans adresse
// ---------------------------------------------------------------------------

class PullError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Le code d'une erreur système ou réseau, jamais son message. */
function codeOf(err: unknown): string {
  const direct = (err as { code?: unknown } | null)?.code;
  if (typeof direct === 'string' && direct !== '') return direct;
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (typeof cause === 'string' && cause !== '') return cause;
  const name = (err as { name?: unknown } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  return 'erreur';
}

/** Borne un code : caractères sûrs seulement, longueur plafonnée. */
function sanitize(code: string): string {
  return code.replace(/[^A-Za-z0-9_:.,=>-]/g, '_').slice(0, ERROR_MAX);
}

function errorOf(err: unknown, fallback: string): string {
  return sanitize(err instanceof PullError ? err.code : `${fallback}:${codeOf(err)}`);
}

// ---------------------------------------------------------------------------
// GitHub, au plus près : trois requêtes, rien de plus
// ---------------------------------------------------------------------------

interface ReleaseAsset {
  id: number;
  name: string;
  size: number;
}

interface ReleaseInfo {
  tag: string;
  published_at: string | null;
  assets: ReleaseAsset[];
}

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new PullError(`network_${codeOf(err)}`);
  }
}

function statusError(res: Response, prefix: string): PullError {
  if (res.status === 401) return new PullError(`${prefix}_unauthorized`);
  if (res.status === 403)
    return new PullError(
      res.headers.get('x-ratelimit-remaining') === '0'
        ? `${prefix}_rate_limited`
        : `${prefix}_forbidden`,
    );
  if (res.status === 404) return new PullError(`${prefix}_not_found`);
  return new PullError(`${prefix}_http_${res.status}`);
}

/**
 * Lit un corps sans jamais dépasser `max` octets : au-delà, la lecture est
 * abandonnée (`tooLarge`). Chaque morceau part vers `sink` au fil de l'eau.
 */
async function readCapped(
  res: Response,
  max: number,
  tooLarge: string,
  sink: (chunk: Uint8Array) => void,
): Promise<number> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => undefined);
    throw new PullError(tooLarge);
  }
  if (!res.body) return 0;
  const reader = res.body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        throw new PullError(tooLarge);
      }
      sink(value);
    }
  } catch (err) {
    if (err instanceof PullError) throw err;
    throw new PullError(`network_read_${codeOf(err)}`);
  }
  return total;
}

class GithubReleases {
  constructor(
    private readonly base: string,
    private readonly repo: string,
    private readonly token: string,
  ) {}

  private headers(accept: string): Record<string, string> {
    return {
      Accept: accept,
      Authorization: `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': USER_AGENT,
    };
  }

  async latestRelease(): Promise<ReleaseInfo> {
    const res = await request(
      `${this.base}/repos/${this.repo}/releases/latest`,
      { headers: this.headers('application/vnd.github+json') },
      API_TIMEOUT_MS,
    );
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => undefined);
      throw statusError(res, 'github');
    }
    const chunks: Uint8Array[] = [];
    await readCapped(res, RELEASE_MAX_BYTES, 'release_too_large', (c) => chunks.push(c));
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new PullError('release_not_json');
    }
    return parseRelease(raw);
  }

  /**
   * Un asset, par l'API (jamais par une adresse lue dans une réponse). GitHub
   * répond le contenu, ou une redirection vers une adresse signée de son
   * stockage : celle-ci est suivie SANS le jeton, et n'est écrite nulle part.
   */
  async downloadAsset(
    asset: ReleaseAsset,
    max: number,
    tooLarge: string,
    sink: (chunk: Uint8Array) => void,
  ): Promise<number> {
    const url = `${this.base}/repos/${this.repo}/releases/assets/${asset.id}`;
    let res = await request(
      url,
      { headers: this.headers('application/octet-stream'), redirect: 'manual' },
      DOWNLOAD_TIMEOUT_MS,
    );
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      await res.body?.cancel().catch(() => undefined);
      let target: URL;
      try {
        target = new URL(location ?? '', url);
      } catch {
        throw new PullError('asset_redirect_invalid');
      }
      // https seulement ; http n'est admis que si l'API elle-même l'est (tests locaux).
      const httpAllowed = new URL(this.base).protocol === 'http:';
      if (
        !location ||
        !(target.protocol === 'https:' || (httpAllowed && target.protocol === 'http:'))
      )
        throw new PullError('asset_redirect_invalid');
      res = await request(
        target.href,
        { headers: { Accept: 'application/octet-stream', 'User-Agent': USER_AGENT } },
        DOWNLOAD_TIMEOUT_MS,
      );
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => undefined);
      throw statusError(res, 'asset');
    }
    return readCapped(res, max, tooLarge, sink);
  }
}

function parseRelease(raw: unknown): ReleaseInfo {
  if (!isRecord(raw)) throw new PullError('release_invalid');
  const tag = raw.tag_name;
  if (typeof tag !== 'string' || !TAG_PATTERN.test(tag)) throw new PullError('release_invalid');
  const published =
    typeof raw.published_at === 'string' && !Number.isNaN(Date.parse(raw.published_at))
      ? new Date(raw.published_at).toISOString()
      : null;
  if (!Array.isArray(raw.assets)) throw new PullError('release_invalid');
  const assets = raw.assets.flatMap((a): ReleaseAsset[] =>
    isRecord(a) &&
    typeof a.id === 'number' &&
    Number.isSafeInteger(a.id) &&
    a.id > 0 &&
    typeof a.name === 'string' &&
    typeof a.size === 'number' &&
    Number.isSafeInteger(a.size) &&
    (a.state === undefined || a.state === 'uploaded')
      ? [{ id: a.id, name: a.name, size: a.size }]
      : [],
  );
  return { tag, published_at: published, assets };
}

// ---------------------------------------------------------------------------
// Un fichier : comparer, télécharger, contrôler, poser
// ---------------------------------------------------------------------------

function safeSha256(path: string): string | null {
  try {
    return existsSync(path) && statSync(path).isFile() ? sha256File(path) : null;
  } catch {
    return null;
  }
}

/**
 * Les empreintes que l'API sert ou a acceptées pour une base : la surcouche
 * servie, le fichier en place (peut-être pas encore rechargé) et la copie
 * acceptée. Une release qui annonce l'une d'elles n'a rien à apporter.
 */
function knownFiles(kind: OverlayKind, target: string): Set<string> {
  const known = new Set<string>();
  const status = restrictedOverlayStatus().find((s) => s.kind === kind);
  if (status && servesOverlay(status.state) && status.sha256) known.add(status.sha256);
  for (const path of [target, acceptedCopyPath(target)]) {
    const sha = safeSha256(path);
    if (sha) known.add(sha);
  }
  return known;
}

/** Restes d'un tirage interrompu (processus arrêté pendant un téléchargement). */
function cleanNeighbours(target: string): void {
  const prefix = `${basename(target)}${NEIGHBOUR_INFIX}`;
  let names: string[];
  try {
    names = readdirSync(dirname(target));
  } catch {
    return;
  }
  for (const name of names)
    if (name.startsWith(prefix)) rmSync(join(dirname(target), name), { force: true });
}

type KindOutcome = 'installed' | 'up_to_date' | 'absent_from_release' | 'refused_before' | 'error';

interface KindResult {
  outcome: KindOutcome;
  error?: string;
  /** Vrai quand le fichier est refusé pour ce qu'il est : jamais retéléchargé. */
  rejectFile?: boolean;
}

async function pullOne(
  api: GithubReleases,
  kind: OverlayKind,
  target: string,
  entry: ManifestFile,
  release: ReleaseInfo,
  rejected: PullState['rejected'],
): Promise<KindResult> {
  if (knownFiles(kind, target).has(entry.sha256)) return { outcome: 'up_to_date' };
  const before = rejected[kind];
  if (before && before.sha256 === entry.sha256)
    return { outcome: 'refused_before', error: before.error };
  if (entry.bytes > OVERLAY_DOWNLOAD_MAX_BYTES)
    return { outcome: 'error', error: `file_too_large:${kind}`, rejectFile: true };
  const asset = release.assets.find((a) => a.name === entry.name);
  if (!asset) return { outcome: 'error', error: `asset_missing:${kind}` };
  if (asset.size !== entry.bytes) return { outcome: 'error', error: `asset_size_mismatch:${kind}` };

  const neighbour = join(dirname(target), `${basename(target)}${NEIGHBOUR_INFIX}${randomUUID()}`);
  try {
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const hash = createHash('sha256');
    const fd = openSync(neighbour, 'wx', 0o600);
    let received: number;
    try {
      received = await api.downloadAsset(asset, entry.bytes, `download_too_large:${kind}`, (c) => {
        hash.update(c);
        let offset = 0;
        while (offset < c.byteLength) offset += writeSync(fd, c, offset);
      });
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (received !== entry.bytes) return { outcome: 'error', error: `download_truncated:${kind}` };
    // Une empreinte fausse peut venir d'un transfert abîmé : le prochain tirage réessaie.
    if (hash.digest('hex') !== entry.sha256)
      return { outcome: 'error', error: `sha256_mismatch:${kind}` };
    chmodSync(neighbour, 0o600);
    const inspection = inspectOverlay(neighbour, kind);
    if (!inspection.ok)
      return {
        outcome: 'error',
        error: `overlay_refused:${kind}:${inspection.error ?? '?'}`,
        rejectFile: true,
      };
    const refused = inspection.members.filter((m) => m.state !== 'applied');
    if (refused.length > 0)
      return {
        outcome: 'error',
        error: `members_refused:${kind}:${refused.map((m) => `${m.id}=${m.reason ?? '?'}`).join(',')}`,
        rejectFile: true,
      };
    const mismatch = inspection.members.find((m) => entry.members[m.id] !== m.rows);
    if (mismatch)
      return {
        outcome: 'error',
        error: `manifest_mismatch:${kind}:${mismatch.id}`,
        rejectFile: true,
      };
    // Le voisin devient le fichier de la variable d'un seul renommage : la veille
    // ne voit jamais un fichier à moitié écrit.
    renameSync(neighbour, target);
    return { outcome: 'installed' };
  } catch (err) {
    return { outcome: 'error', error: errorOf(err, `install_failed:${kind}`) };
  } finally {
    // Le voisin (s'il n'a pas été renommé) et les compagnons qu'une lecture
    // SQLite aurait laissés à côté de lui.
    removeFileWithCompanions(neighbour);
  }
}

// ---------------------------------------------------------------------------
// Un tirage complet, et ce qu'il dit
// ---------------------------------------------------------------------------

export interface PullOptions {
  /** Racine de l'API GitHub : un faux serveur local dans les tests. */
  apiBase?: string;
  /** Horloge, pour les tests des délais. */
  now?: () => number;
}

export interface PullAttempt {
  state: 'off' | 'ok' | 'error';
  error: string | null;
  release: string | null;
  kinds: Partial<Record<OverlayKind, KindOutcome>>;
  /** Les bases dont le fichier de la variable vient d'être remplacé. */
  installed: OverlayKind[];
}

function ageDays(iso: string, now: number): number {
  return Math.round(((now - Date.parse(iso)) / DAY) * 10) / 10;
}

/** Ce qui est trop ancien dans la release lue, pour les bases tirées. */
function staleness(
  release: ReleaseInfo,
  manifest: OverlayManifest,
  targets: Partial<Record<OverlayKind, string | null>>,
  now: number,
): string[] {
  const stale: string[] = [];
  if (release.published_at && now - Date.parse(release.published_at) > RELEASE_MAX_AGE_DAYS * DAY)
    stale.push(`release:${Math.floor(ageDays(release.published_at, now))}d`);
  for (const kind of KINDS) {
    if (!(kind in targets)) continue;
    const entry = manifest.files[kind];
    if (!entry) stale.push(`${kind}:absent`);
    else if (now - Date.parse(entry.generated_at) > FILE_MAX_AGE_DAYS[kind] * DAY)
      stale.push(`${kind}:${Math.floor(ageDays(entry.generated_at, now))}d`);
  }
  return stale;
}

function nextDue(now: number, ok: boolean): string {
  const wait = ok
    ? PULL_INTERVAL_MS + Math.random() * PULL_JITTER_MS
    : PULL_RETRY_MS + Math.random() * RETRY_JITTER_MS;
  return new Date(now + wait).toISOString();
}

/** Alertes du tirage : ouvertes sur une transition, refermées seules. */
function evaluateAlerts(state: PullState, now: number): void {
  if (state.error === null) void opsOk(PULL_ALERT, 'tirage de la surcouche privée rétabli');
  else {
    const since = state.last_success_at ?? state.failing_since;
    if (since && now - Date.parse(since) > PULL_NO_SUCCESS_ALERT_MS)
      void opsFail(
        PULL_ALERT,
        `Surcouche privée : aucun tirage réussi depuis ${Math.floor((now - Date.parse(since)) / HOUR)} h ` +
          `(${state.error}). Jeton expiré ou révoqué, ou dépôt privé inaccessible ? ` +
          'L’API garde la surcouche qu’elle sert.',
      );
  }
  if (state.stale.length > 0)
    void opsFail(
      PULL_STALE_ALERT,
      `Surcouche privée trop ancienne (${state.stale.join(', ')}) : un workflow du dépôt privé ` +
        'ne publie plus. L’API garde la surcouche qu’elle sert.',
    );
  else if (state.release) void opsOk(PULL_STALE_ALERT, 'surcouche privée de nouveau fraîche');
}

function recordConfigError(state: PullState, error: string, now: number): void {
  const iso = new Date(now).toISOString();
  const next: PullState = {
    ...state,
    configured: true,
    error,
    failing_since: state.failing_since ?? iso,
  };
  if (next.error !== state.error || next.failing_since !== state.failing_since || !state.configured)
    saveState(next);
  else memory = next;
  evaluateAlerts(next, now);
}

/**
 * Un tirage, tout de suite (la veille, elle, attend son heure : voir
 * `overlayPullTick`). Ne jette jamais ; chaque échec est un code dans l'état.
 */
export async function runOverlayPull(options: PullOptions = {}): Promise<PullAttempt> {
  const clock = options.now ?? Date.now;
  const config = readPullConfig();
  if (config.status === 'off')
    return { state: 'off', error: null, release: null, kinds: {}, installed: [] };
  const state = loadState();
  const started = clock();
  if (config.status === 'error') {
    recordConfigError(state, config.error, started);
    return { state: 'error', error: config.error, release: null, kinds: {}, installed: [] };
  }

  const api = new GithubReleases(options.apiBase ?? GITHUB_API, config.repo, config.token);
  const kinds: PullAttempt['kinds'] = {};
  const errors: string[] = [];
  const installed: OverlayKind[] = [];
  const delivered = [...state.delivered];
  const rejected = { ...state.rejected };
  let release: ReleaseInfo | null = null;
  let stale: string[] | null = null;
  try {
    for (const target of Object.values(config.targets)) if (target) cleanNeighbours(target);
    release = await api.latestRelease();
    const manifestAsset = release.assets.find((a) => a.name === MANIFEST_FILE_NAME);
    if (!manifestAsset) throw new PullError('release_without_manifest');
    const chunks: Uint8Array[] = [];
    await api.downloadAsset(manifestAsset, MANIFEST_MAX_BYTES, 'manifest_too_large', (c) =>
      chunks.push(c),
    );
    const parsed = parseManifest(Buffer.concat(chunks).toString('utf8'));
    if (!parsed.ok) throw new PullError(parsed.error);
    const manifest = parsed.manifest;
    stale = staleness(release, manifest, config.targets, clock());
    for (const kind of KINDS) {
      if (!(kind in config.targets)) continue;
      const target = config.targets[kind];
      if (!target) {
        kinds[kind] = 'error';
        errors.push(`overlay_path_invalid:${kind}`);
        continue;
      }
      const entry = manifest.files[kind];
      if (!entry) {
        kinds[kind] = 'absent_from_release';
        continue;
      }
      const result = await pullOne(api, kind, target, entry, release, rejected);
      kinds[kind] = result.outcome;
      if (result.error) errors.push(sanitize(result.error));
      if (result.rejectFile && result.error)
        rejected[kind] = { sha256: entry.sha256, error: sanitize(result.error) };
      // Un bon fichier arrivé depuis efface le souvenir d'un refus.
      if (result.outcome === 'installed' || result.outcome === 'up_to_date') delete rejected[kind];
      if (result.outcome === 'installed') installed.push(kind);
      // D'où vient ce fichier : gardé pour /health, qui dit la release et l'âge
      // de la surcouche servie. Un fichier déjà posé garde sa première release.
      if (
        (result.outcome === 'installed' || result.outcome === 'up_to_date') &&
        !delivered.some((d) => d.kind === kind && d.sha256 === entry.sha256)
      )
        delivered.unshift({
          kind,
          sha256: entry.sha256,
          release: release.tag,
          generated_at: entry.generated_at,
          public_commit: entry.public_commit,
        });
    }
  } catch (err) {
    errors.unshift(errorOf(err, 'pull_failed'));
  }

  const finished = clock();
  const ok = errors.length === 0;
  const next: PullState = {
    configured: true,
    last_attempt_at: new Date(started).toISOString(),
    last_success_at: ok ? new Date(finished).toISOString() : state.last_success_at,
    failing_since: ok ? null : (state.failing_since ?? new Date(started).toISOString()),
    next_due_at: nextDue(finished, ok),
    error: ok ? null : sanitize(errors.join(';')),
    release: release ? { tag: release.tag, published_at: release.published_at } : state.release,
    delivered: delivered.slice(0, DELIVERED_MAX),
    rejected,
    stale: stale ?? state.stale,
  };
  saveState(next);
  const summary = KINDS.filter((k) => kinds[k])
    .map((k) => `${k}=${kinds[k]}`)
    .join(' ');
  const line = `[surcouche] tirage : ${ok ? 'ok' : `erreur (${next.error})`}${
    release ? `, release ${release.tag}` : ''
  }${summary ? ` ; ${summary}` : ''}`;
  if (ok) console.log(line);
  else console.error(line);
  evaluateAlerts(next, finished);
  return {
    state: ok ? 'ok' : 'error',
    error: next.error,
    release: release?.tag ?? null,
    kinds,
    installed,
  };
}

// ---------------------------------------------------------------------------
// La veille, /health, et le retrait
// ---------------------------------------------------------------------------

let inFlight: Promise<OverlayKind[]> | null = null;
let withdrawalChecked = false;

/**
 * Variables retirées (retour en arrière) : une alerte restée ouverte ferait taire
 * la panne suivante sur la même clé (relecture de la PR 252, R9). On les
 * referme, une fois, et seulement si le tirage a déjà été configuré : sans
 * cela, aucune lecture de plus qu'une ligne de `kv_state` par processus.
 */
function closeAfterWithdrawal(): void {
  if (withdrawalChecked) return;
  withdrawalChecked = true;
  let raw: string | undefined;
  try {
    raw = kvGet(KV_STATE);
  } catch {
    return;
  }
  if (!raw) return;
  let state: PullState;
  try {
    state = reviveState(JSON.parse(raw));
  } catch {
    return;
  }
  if (!state.configured) return;
  void opsOk(PULL_ALERT, 'tirage de la surcouche retiré (variables absentes)');
  void opsOk(PULL_STALE_ALERT);
  saveState({ ...state, configured: false });
  memory = null;
}

/**
 * Un passage de la veille de dix minutes. Lance un tirage s'il est dû, sans
 * l'attendre ; la promesse rend les bases dont le fichier a été remplacé, pour
 * que la veille les recharge aussitôt. Ne rejette jamais. Un tirage encore en
 * cours n'est jamais doublé.
 */
export function overlayPullTick(options: PullOptions = {}): Promise<OverlayKind[]> {
  try {
    const config = readPullConfig();
    if (config.status === 'off') {
      closeAfterWithdrawal();
      return Promise.resolve([]);
    }
    if (inFlight) return Promise.resolve([]);
    const now = (options.now ?? Date.now)();
    const state = loadState();
    if (config.status === 'error') {
      recordConfigError(state, config.error, now);
      return Promise.resolve([]);
    }
    if (state.next_due_at && Date.parse(state.next_due_at) > now) return Promise.resolve([]);
    const run = runOverlayPull(options)
      .then((attempt) => attempt.installed)
      .catch(() => [] as OverlayKind[]);
    const pending = run.finally(() => {
      inFlight = null;
    });
    inFlight = pending;
    return pending;
  } catch (err) {
    console.error(`[surcouche] tirage : passage en échec (${codeOf(err)})`);
    return Promise.resolve([]);
  }
}

/** D'où vient la surcouche servie d'une base, quand un tirage l'a posée. */
export interface OverlayPullOrigin {
  release: string;
  generated_at: string;
  age_days: number;
}

export interface OverlayPullHealth {
  /**
   * `off` : pas de variable du tirage. `pending` : variables posées, aucun
   * tirage encore. `ok` : le dernier tirage a réussi. `error` : le dernier a
   * échoué, ou la configuration est incomplète (voir `error`).
   */
  state: 'off' | 'pending' | 'ok' | 'error';
  last_attempt_at?: string | null;
  last_success_at?: string | null;
  /** La dernière release lue, et sa date de publication. */
  release?: string | null;
  release_published_at?: string | null;
  /** La release et la date de génération du fichier servi pour chaque base. */
  bic?: OverlayPullOrigin | null;
  compliance?: OverlayPullOrigin | null;
  error?: string | null;
}

function servedOrigin(kind: OverlayKind, state: PullState, now: number): OverlayPullOrigin | null {
  const status = restrictedOverlayStatus().find((s) => s.kind === kind);
  if (!status || !servesOverlay(status.state) || !status.sha256) return null;
  const d = state.delivered.find((f) => f.kind === kind && f.sha256 === status.sha256);
  if (!d) return null;
  return {
    release: d.release,
    generated_at: d.generated_at,
    age_days: ageDays(d.generated_at, now),
  };
}

/**
 * Le bloc `restricted_overlays.pull` de /health. Mémoire seulement (l'état est
 * relu de `kv_state` une fois par processus) : Railway sonde toutes les 30 s.
 * Jamais le nom du dépôt, jamais le jeton.
 */
export function restrictedOverlayPullHealth(now: number = Date.now()): OverlayPullHealth {
  const config = readPullConfig();
  if (config.status === 'off') return { state: 'off' };
  const s = loadState();
  const error = config.status === 'error' ? config.error : s.error;
  return {
    state: error ? 'error' : s.last_attempt_at ? 'ok' : 'pending',
    last_attempt_at: s.last_attempt_at,
    last_success_at: s.last_success_at,
    release: s.release?.tag ?? null,
    release_published_at: s.release?.published_at ?? null,
    bic: servedOrigin('bic', s, now),
    compliance: servedOrigin('compliance', s, now),
    error: error ?? null,
  };
}

/**
 * Réservé aux tests : oublie la mémoire, comme un redémarrage. `forget` efface
 * aussi l'état gardé dans `kv_state`.
 */
export function resetOverlayPullForTests(options: { forget?: boolean } = {}): void {
  memory = null;
  inFlight = null;
  withdrawalChecked = false;
  if (options.forget) kvSet(KV_STATE, '');
}
