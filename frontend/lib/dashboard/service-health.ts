/** Une sonde du navigateur ne démontre ni une panne mondiale, ni l’état de la collecte. */
export interface ServiceHealth {
  version: string;
  uptime_seconds: number;
  bic_database_entries: number;
}

export type HealthProbe =
  | { kind: 'checking' | 'unverified' | 'reported-error'; health: null; elapsedMs: null }
  | { kind: 'reachable'; health: ServiceHealth; elapsedMs: number };

export const uncheckedHealth: HealthProbe = { kind: 'checking', health: null, elapsedMs: null };

export function readServiceHealth(value: unknown): ServiceHealth | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.status !== 'ok' || typeof v.version !== 'string' || !v.version.trim()) return null;
  if (
    typeof v.uptime_seconds !== 'number' ||
    !Number.isFinite(v.uptime_seconds) ||
    v.uptime_seconds < 0
  )
    return null;
  if (!Number.isSafeInteger(v.bic_database_entries) || (v.bic_database_entries as number) < 0)
    return null;
  if (v.databases !== undefined) {
    if (!v.databases || typeof v.databases !== 'object') return null;
    const db = v.databases as Record<string, unknown>;
    if (['bic', 'stats', 'compliance'].some((key) => db[key] !== 'ok')) return null;
  }
  return {
    version: v.version,
    uptime_seconds: v.uptime_seconds,
    bic_database_entries: v.bic_database_entries as number,
  };
}

/** Le délai mesure uniquement une réponse de santé réussie et complètement lue. */
export async function probeServiceHealth(url: string, signal: AbortSignal): Promise<HealthProbe> {
  const started = performance.now();
  try {
    const response = await fetch(url, { signal, cache: 'no-store' });
    if (!response.ok) return { kind: 'reported-error', health: null, elapsedMs: null };
    const payload: unknown = await response.json();
    if (
      payload &&
      typeof payload === 'object' &&
      'status' in payload &&
      payload.status === 'error'
    ) {
      return { kind: 'reported-error', health: null, elapsedMs: null };
    }
    const health = readServiceHealth(payload);
    return health
      ? { kind: 'reachable', health, elapsedMs: Math.round(performance.now() - started) }
      : { kind: 'unverified', health: null, elapsedMs: null };
  } catch {
    return { kind: 'unverified', health: null, elapsedMs: null };
  }
}

/** Âge au moment où la page lit les statistiques, pas une surveillance de leurs écritures. */
export function recordedActivityAge(
  lastWriteAt: string | null | undefined,
  readAt: number | null,
): number | null {
  if (!lastWriteAt || readAt === null || !Number.isFinite(readAt)) return null;
  const iso = lastWriteAt.includes('T') ? lastWriteAt : lastWriteAt.replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(iso))
    return null;
  const day = iso.slice(0, 10);
  const midnight = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== day)
    return null;
  const at = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`);
  if (!Number.isFinite(at) || at > readAt) return null;
  return Math.floor((readAt - at) / 60_000);
}
