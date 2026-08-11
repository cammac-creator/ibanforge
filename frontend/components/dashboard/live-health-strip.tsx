'use client';

import { useEffect, useState, useCallback } from 'react';
import { useLocale, useTranslations } from 'next-intl';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://ibanforge-production.up.railway.app';
const LOCALE_TAG: Record<string, string> = { en: 'en-US', fr: 'fr-CH', de: 'de-CH' };

interface HealthData {
  status: string;
  version: string;
  uptime_seconds: number;
  bic_database_entries: number;
}

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

function Metric({ label, value, valueClass = 'text-white' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] font-semibold uppercase tracking-widest text-[var(--fg-5)]">{label}</span>
      <span className={`font-mono text-sm font-semibold leading-tight ${valueClass}`}>{value}</span>
    </div>
  );
}

/**
 * The collector can die while the API stays green: /health answers, every
 * counter reads zero, and the zeros look exactly like a quiet day (that
 * ambiguity once cost a full diagnosis session). The page passes the newest
 * request_log timestamp; past 30 minutes of silence during waking hours
 * (06:00-22:00 UTC) the strip turns into an explicit red banner.
 */
function staleness(lastWriteAt: string | null | undefined): { stale: boolean; minutes: number } {
  if (!lastWriteAt) return { stale: false, minutes: 0 };
  const iso = lastWriteAt.includes('T') ? lastWriteAt : lastWriteAt.replace(' ', 'T');
  const t = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`).getTime();
  if (Number.isNaN(t)) return { stale: false, minutes: 0 };
  const minutes = Math.floor((Date.now() - t) / 60_000);
  const hour = new Date().getUTCHours();
  return { stale: minutes > 30 && hour >= 6 && hour < 22, minutes };
}

/**
 * Compact, always-live API health strip — replaces the full monitoring page.
 * Polls /health from the browser every 60s. Renders a neutral "checking" state
 * on first paint (no data yet), so it is safe in a one-shot screenshot.
 */
export function LiveHealthStrip({ lastWriteAt }: { lastWriteAt?: string | null }) {
  const locale = useLocale();
  const tag = LOCALE_TAG[locale] ?? 'en-US';
  const t = useTranslations('dashboard');
  const fmt = (n: number) => n.toLocaleString(tag);

  const [online, setOnline] = useState<boolean | null>(null);
  const [ms, setMs] = useState(0);
  const [health, setHealth] = useState<HealthData | null>(null);

  const check = useCallback(async () => {
    const start = Date.now();
    try {
      const res = await fetch(`${API_URL}/health`);
      const took = Date.now() - start;
      setMs(took);
      if (res.ok) {
        setHealth((await res.json()) as HealthData);
        setOnline(true);
      } else {
        setOnline(false);
      }
    } catch {
      setMs(Date.now() - start);
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    // Polling: initial check + 60s interval. State updates are intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    check();
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, [check]);

  const loading = online === null;
  // Recomputed on every render — the 60 s poll's setState keeps renders coming,
  // so a collector that dies while the tab stays open still turns the banner
  // red within a minute of crossing the threshold.
  const fresh = staleness(lastWriteAt);

  return (
    <div className="flex flex-col gap-2">
    {fresh.stale && (
      <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-5 py-3 text-sm font-medium text-red-300">
        ⚠ Collecte des stats en panne — dernière écriture il y a {fresh.minutes} min. Les zéros et les
        creux ci-dessous ne sont pas fiables tant que ce bandeau est visible.
      </div>
    )}
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-[var(--ink-4)]/60 bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 px-5 py-3.5">
      {/* Status */}
      <div className="flex items-center gap-2.5">
        <span className="relative flex h-2.5 w-2.5">
          {!loading && online && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500/60" />
          )}
          <span
            className={[
              'relative inline-flex h-2.5 w-2.5 rounded-full',
              loading ? 'bg-[var(--fg-5)]' : online ? 'bg-green-500' : 'bg-red-500',
            ].join(' ')}
          />
        </span>
        <span className="text-sm font-semibold text-white">
          {loading ? t('monitoring.checking') : online ? t('monitoring.apiOnline') : t('monitoring.apiOffline')}
        </span>
      </div>

      <div className="hidden h-6 w-px bg-[var(--ink-4)] sm:block" />

      <Metric
        label={t('monitoring.responseTime')}
        value={loading ? '—' : `${ms} ms`}
        valueClass={loading ? 'text-[var(--fg-4)]' : msColor(ms)}
      />
      <Metric label={t('monitoring.version')} value={health ? `v${health.version}` : '—'} />
      <Metric label={t('monitoring.uptime')} value={health ? fmtUptime(health.uptime_seconds) : '—'} />
      <Metric
        label={t('monitoring.bicDatabase')}
        value={health ? fmt(health.bic_database_entries) : '—'}
      />
      {lastWriteAt !== undefined && (
        <Metric
          label="Dernière écriture stats"
          value={lastWriteAt === null ? '—' : `il y a ${fresh.minutes} min`}
          valueClass={fresh.stale ? 'text-red-400' : fresh.minutes <= 10 ? 'text-green-400' : 'text-yellow-400'}
        />
      )}
    </div>
    </div>
  );
}
