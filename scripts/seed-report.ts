/**
 * Le rapport des seeders de la famille « sous conditions », pour la reprise
 * membre par membre de la surcouche privée.
 *
 * ## Pourquoi ce fichier existe
 *
 * `npm run overlay -- seed --kind bic` (scripts/restricted-overlay.ts) part d'une
 * copie de la base publique sans la famille, puis lance les seeders. Jusqu'au
 * 25/09/2026, une seule source en panne laissait son membre vide, le plancher
 * refusait toute la surcouche, et rien n'était publié ce mois-là, pas même les
 * membres frais. Désormais chaque seeder DIT ce qu'il a fait de chaque membre :
 * une ligne JSON par membre dans le fichier que nomme SEED_REPORT_PATH, `loaded`
 * (avec le nombre de lignes lues à la source) ou `failed` (avec un code court).
 * La commande `seed` reprend alors de la surcouche précédente les seuls membres
 * en panne (scripts/restricted-carry-over.ts).
 *
 * ## Jamais un message brut
 *
 * Le rapport, la sortie de `seed` et le manifeste ne portent que des codes : un
 * message d'erreur peut recopier une ligne de la source (le parseur PRA cite la
 * ligne qu'il ne comprend pas), et ces sorties partent dans des journaux.
 *
 * Sans la variable (les robots publics, un lancement à la main), rien n'est écrit
 * et chaque seeder se comporte exactement comme avant.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

/** La variable qui active le rapport : posée par `npm run overlay -- seed` seulement. */
export const SEED_REPORT_ENV = 'SEED_REPORT_PATH';

export type SeedMemberState = 'loaded' | 'failed';

export interface SeedMemberReport {
  /** Identifiant du membre dans src/lib/restricted-family.ts. */
  member: string;
  state: SeedMemberState;
  /** Code court de l'échec (`http_503`, `network`, `below_floor`…), jamais un message. */
  cause?: string;
  /** Lignes lues à la source (avant tout INSERT OR IGNORE), pour un chargement réussi. */
  processed?: number;
}

const MEMBER_ID = /^[a-z0-9_]{1,64}$/;
/** La forme d'un code de cause : des minuscules, des chiffres et `_`, jamais une phrase. */
export const FAILURE_CAUSE = /^[a-z0-9_]{1,40}$/;

/** Le rapport est-il demandé ? (La chaîne privée de la surcouche seulement.) */
export function seedReportActive(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env[SEED_REPORT_ENV];
}

function checkReport(value: unknown): SeedMemberReport | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { member, state, cause, processed } = value as Record<string, unknown>;
  if (typeof member !== 'string' || !MEMBER_ID.test(member)) return null;
  if (state !== 'loaded' && state !== 'failed') return null;
  if (cause !== undefined && (typeof cause !== 'string' || !FAILURE_CAUSE.test(cause))) return null;
  if (state === 'failed' && cause === undefined) return null;
  if (
    processed !== undefined &&
    (typeof processed !== 'number' || !Number.isSafeInteger(processed) || processed < 0)
  )
    return null;
  return {
    member,
    state,
    ...(cause !== undefined ? { cause } : {}),
    ...(processed !== undefined ? { processed } : {}),
  };
}

/**
 * Note l'issue d'un membre. Sans SEED_REPORT_PATH : rien. Un rapport mal formé
 * est une faute de code, qui fait échouer le seeder plutôt que d'écrire une
 * ligne que la reprise refuserait.
 */
export function reportSeedMember(
  report: SeedMemberReport,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const path = env[SEED_REPORT_ENV];
  if (!path) return;
  const checked = checkReport(report);
  if (!checked) throw new Error(`Rapport de seeder mal formé pour « ${report.member} »`);
  appendFileSync(path, `${JSON.stringify(checked)}\n`, { mode: 0o600 });
}

/**
 * Le code court d'un échec, lu dans l'erreur sans jamais en recopier le texte :
 * `timeout`, `http_<statut>`, `network`, `download_failed`, `below_floor`, sinon
 * `error` (le message complet reste dans le journal du seeder).
 */
export function failureCause(err: unknown): string {
  const e = err as { name?: unknown; message?: unknown } | null;
  const name = typeof e?.name === 'string' ? e.name : '';
  const message = typeof e?.message === 'string' ? e.message : '';
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  const status = /\bHTTP (\d{3})\b/.exec(message);
  if (status) return `http_${status[1]}`;
  if (name === 'TypeError' && /fetch failed/i.test(message)) return 'network';
  if (/download failed/i.test(message)) return 'download_failed';
  if (/expected at least \d+/i.test(message)) return 'below_floor';
  return 'error';
}

/**
 * Relit le rapport d'un passage : la dernière ligne d'un membre l'emporte.
 * Fichier absent : aucun membre rapporté. Une ligne illisible est une faute de
 * code, jamais une panne de source : erreur.
 */
export function readSeedReport(path: string): Map<string, SeedMemberReport> {
  const reports = new Map<string, SeedMemberReport>();
  if (!existsSync(path)) return reports;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error('Rapport de seeder illisible (ligne qui n’est pas du JSON)');
    }
    const report = checkReport(parsed);
    if (!report) throw new Error('Rapport de seeder illisible (ligne mal formée)');
    reports.set(report.member, report);
  }
  return reports;
}
