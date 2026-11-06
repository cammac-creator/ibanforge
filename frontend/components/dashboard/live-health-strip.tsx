'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatGrouped } from '@/lib/format-grouped';
import { InfoDot } from './info-dot';
import {
  probeServiceHealth,
  recordedActivityAge,
  uncheckedHealth,
  type HealthProbe,
} from '@/lib/dashboard/service-health';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://ibanforge-production.up.railway.app';

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function msColor(ms: number): string {
  if (ms < 100) return 'text-green-400';
  if (ms < 500) return 'text-yellow-400';
  return 'text-red-400';
}

function Metric({
  label,
  value,
  valueClass = 'text-[var(--fg-1)]',
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] font-semibold uppercase tracking-widest text-[var(--fg-5)]">
        {label}
      </span>
      <span className={`font-mono text-sm font-semibold leading-tight ${valueClass}`}>{value}</span>
    </div>
  );
}

/** Dernière activité enregistrée : une période calme n’est pas un diagnostic de panne. */
export function RecordedActivity({
  lastWriteAt,
  readAt,
  compact = false,
}: {
  lastWriteAt?: string | null;
  readAt: number;
  compact?: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations('dashboard');
  const minutes = recordedActivityAge(lastWriteAt, readAt);
  const quiet = minutes !== null && minutes > 30;
  if (compact && !quiet) return null;
  return (
    <div className="flex flex-col gap-2" data-recorded-activity>
      {quiet && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-5 py-3 text-sm text-[var(--fg-2)]">
          {t('monitoring.quietActivity', { minutes: formatGrouped(minutes, locale) })}
        </p>
      )}
      {!compact && (
        <div className="rounded-xl border border-[var(--ink-4)] px-5 py-3">
          <Metric label={t('monitoring.recordedActivity')}
            value={minutes === null ? '—' : t('monitoring.minutesAgo', { minutes: formatGrouped(minutes, locale) })}
            valueClass="text-[var(--fg-3)]" />
        </div>
      )}
    </div>
  );
}

/** La sonde démarre indépendamment des statistiques, puis revient chaque minute. */
export function LiveHealthStrip({ compact = false }: { compact?: boolean }) {
  const locale = useLocale();
  const t = useTranslations('dashboard');
  const fmt = (n: number) => formatGrouped(n, locale);

  const [probe, setProbe] = useState<HealthProbe>(uncheckedHealth);
  useEffect(() => {
    let disposed = false;
    let controller: AbortController | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      controller = new AbortController();
      timeout = setTimeout(() => controller?.abort(), 8_000);
      const result = await probeServiceHealth(`${API_URL}/health`, controller.signal);
      clearTimeout(timeout);
      if (!disposed) setProbe(result);
    };
    void check();
    const interval = setInterval(() => {
      void check();
    }, 60_000);
    return () => {
      disposed = true;
      clearInterval(interval);
      clearTimeout(timeout);
      controller?.abort();
    };
  }, []);

  const loading = probe.kind === 'checking';
  const online = probe.kind === 'reachable';
  const health = probe.health;
  const status = loading
    ? 'checking'
    : online
      ? 'probeReachable'
      : probe.kind === 'reported-error'
        ? 'probeError'
        : 'probeUnverified';

  return (
    <div className="flex flex-col gap-2" data-live-health>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-[var(--ink-4)]/60 bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 px-5 py-3.5">
        {/* Résultat de la dernière sonde, limité à ce navigateur. */}
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            {!loading && online && (
              <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-green-500/60" />
            )}
            <span
              className={[
                'relative inline-flex h-2.5 w-2.5 rounded-full',
                loading
                  ? 'bg-[var(--fg-5)]'
                  : online
                    ? 'bg-green-500'
                    : probe.kind === 'reported-error'
                      ? 'bg-red-500'
                      : 'bg-amber-500',
              ].join(' ')}
            />
          </span>
          <span role="status" className="text-sm font-semibold text-[var(--fg-1)]">
            {t(`monitoring.${status}`)}
          </span>
          <InfoDot>{t('monitoring.probeHint')}</InfoDot>
        </div>

        <div className="hidden h-6 w-px bg-[var(--ink-4)] sm:block" />

        <Metric
          label={t('monitoring.responseTime')}
          value={probe.elapsedMs === null ? '—' : `${probe.elapsedMs} ms`}
          valueClass={probe.elapsedMs === null ? 'text-[var(--fg-4)]' : msColor(probe.elapsedMs)}
        />
        {!compact && (
          <>
            <Metric label={t('monitoring.version')} value={health ? `v${health.version}` : '—'} />
            <Metric
              label={t('monitoring.uptime')}
              value={health ? fmtUptime(health.uptime_seconds) : '—'}
            />
            <Metric
              label={t('monitoring.bicDatabase')}
              value={health ? fmt(health.bic_database_entries) : '—'}
            />

          </>
        )}
      </div>
    </div>
  );
}
