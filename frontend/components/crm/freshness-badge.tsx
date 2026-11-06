'use client';

import { useEffect, useState, useTransition } from 'react';
import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { formatGrouped } from '@/lib/format-grouped';
import { readViewAge, readViewTimestamp } from '@/lib/dashboard/view-freshness';

/** Horodatage de la vue et actualisation volontaire, sans déplacer les données au fil du temps. */
export function FreshnessBadge({ fetchedAtIso }: { fetchedAtIso: string }) {
  const router = useRouter(), locale = useLocale(), t = useTranslations('dashboard.freshness');
  const [busy, startRefresh] = useTransition();
  const [clock, setClock] = useState<{ key: string; at: number } | null>(null);
  const stamp = readViewTimestamp(fetchedAtIso);
  const age = clock?.key === fetchedAtIso ? readViewAge(stamp?.epoch ?? null, clock.at) : null;
  const stale = !stamp || age?.stale;

  useEffect(() => {
    const tick = () => setClock({ key: fetchedAtIso, at: Date.now() });
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [fetchedAtIso]);

  return (
    <span data-view-freshness className="inline-flex max-w-full flex-wrap items-center gap-3 text-xs">
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[var(--fg-3)]">
          {stamp ? <time dateTime={stamp.iso}>{t('readAt', { date: stamp.date, time: stamp.time })}</time> : <span>{t('unknown')}</span>}
          {stamp && age && <span className={stale ? 'font-medium text-[var(--warn)]' : 'text-[var(--fg-4)]'}>
            {t(`age.${age.kind}`, { value: formatGrouped(age.value, locale) })}
          </span>}
        </span>
        <span className="max-w-[42ch] leading-relaxed text-[var(--fg-4)]">{t('scope')}</span>
      </span>
      <button type="button" onClick={() => startRefresh(() => router.refresh())} disabled={busy}
        title={t('refreshLabel')} aria-label={t(busy ? 'refreshingLabel' : 'refreshLabel')} aria-busy={busy}
        className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 py-2 font-medium transition-colors ${
          stale ? 'border-[var(--warn)] text-[var(--warn)] hover:bg-[var(--ink-3)]'
            : 'border-[var(--ink-5)] text-[var(--fg-2)] hover:bg-[var(--ink-3)]'
        } disabled:opacity-60`}>
        <RefreshCw size={15} className={busy ? 'animate-spin motion-reduce:animate-none' : undefined} aria-hidden />
        <span>{t(busy ? 'refreshing' : 'refresh')}</span>
      </button>
    </span>
  );
}
