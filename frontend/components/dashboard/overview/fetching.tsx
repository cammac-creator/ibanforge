import { getTranslations } from 'next-intl/server';

/**
 * The overview's upstream reads, and the block that renders when one fails.
 *
 * Lifted out of page.tsx on 2026-09-01 (ENS-05, ENS-07): the page no longer
 * awaits anything before its first byte, so every section fetches on its own
 * and must be able to say "this could not be read" in its own words. Four
 * blocks did that and four rendered zeros instead, which is how a rotated
 * token once looked exactly like four days of collapsed traffic.
 */
export interface Fetched<T> {
  ok: boolean;
  /** HTTP status; 0 = network failure/timeout. */
  status: number;
  data: T | null;
}

export async function fetchJSON<T>(url: string, headers: HeadersInit): Promise<Fetched<T>> {
  try {
    const res = await fetch(url, { cache: 'no-store', headers });
    if (!res.ok) return { ok: false, status: res.status, data: null };
    return { ok: true, status: res.status, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/**
 * The status of a read that never left, because ADMIN_SECRET is not set.
 *
 * Not 0: 0 already means "the network refused us", and the old page said
 * "ADMIN_SECRET non configuré" in so many words. A missing secret is a
 * deployment fact and an unreachable API is an incident; collapsing the two
 * into one grey box costs an evening of looking for the wrong problem.
 */
export const NO_SECRET = -1;

/** A read that never happened, for the branches where a secret is missing. */
export function notFetched<T>(): Fetched<T> {
  return { ok: false, status: NO_SECRET, data: null };
}

export async function FetchFailed({ name, status }: { name: string; status: number }) {
  const t = await getTranslations('dashboard.overview');
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-center">
      <p className="text-sm font-medium text-red-300">{t('failed.title', { name })}</p>
      <p className="text-xs text-[var(--fg-4)]">
        {status === NO_SECRET
          ? t('failed.noSecret')
          : status === 0
            ? t('failed.unreachable')
            : status === 401 || status === 403
              ? t('failed.token', { status })
              : t('failed.http', { status })}{' '}
        {t('failed.notZeros')}
      </p>
    </div>
  );
}
