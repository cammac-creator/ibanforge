'use client';

import { useEffect, useState, useCallback } from 'react';
import { UptimeBar } from '@/components/uptime-bar';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const STORAGE_KEY = 'ibanforge_uptime_checks';

interface HealthData {
  status: string;
  version: string;
  uptime_seconds: number;
  bic_database_entries: number;
  stats: {
    total_operations: number;
    iban_validations: number;
    bic_lookups: number;
    success_rate: number;
  };
}

interface UptimeCheck {
  date: string;
  status: 'up' | 'down';
  response_ms: number;
}

function loadChecks(): UptimeCheck[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as UptimeCheck[];
  } catch {
    return [];
  }
}

function saveChecks(checks: UptimeCheck[]): void {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const filtered = checks.filter((c) => new Date(c.date) >= cutoff);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // SSR safety
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days} jour${days > 1 ? 's' : ''}, ${hours} heure${hours > 1 ? 's' : ''}`;
  }
  if (hours > 0) {
    return `${hours} heure${hours > 1 ? 's' : ''}, ${mins} min`;
  }
  return `${mins} minute${mins > 1 ? 's' : ''}`;
}

function responseTimeColor(ms: number): string {
  if (ms < 100) return 'text-green-400';
  if (ms < 500) return 'text-yellow-400';
  return 'text-red-400';
}

function responseTimeBg(ms: number): string {
  if (ms < 100) return 'bg-green-500/10 border-green-500/20';
  if (ms < 500) return 'bg-yellow-500/10 border-yellow-500/20';
  return 'bg-red-500/10 border-red-500/20';
}

function fmt(n: number): string {
  return n.toLocaleString('fr-CH');
}

export default function MonitoringPage() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [responseMs, setResponseMs] = useState<number>(0);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [checks, setChecks] = useState<UptimeCheck[]>([]);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const runCheck = useCallback(async () => {
    const start = Date.now();
    let newStatus: 'up' | 'down' = 'down';
    let ms = 0;
    let data: HealthData | null = null;

    try {
      const res = await fetch(`${API_URL}/health`);
      ms = Date.now() - start;
      if (res.ok) {
        data = (await res.json()) as HealthData;
        newStatus = 'up';
      } else {
        ms = Date.now() - start;
      }
    } catch {
      ms = Date.now() - start;
    }

    const check: UptimeCheck = {
      date: new Date().toISOString(),
      status: newStatus,
      response_ms: ms,
    };

    setOnline(newStatus === 'up');
    setResponseMs(ms);
    setHealth(data);
    setLastChecked(new Date());

    setChecks((prev) => {
      const updated = [...prev, check];
      saveChecks(updated);
      return updated;
    });
  }, []);

  useEffect(() => {
    const stored = loadChecks();
    setChecks(stored);
    runCheck();
    const interval = setInterval(runCheck, 60_000);
    return () => clearInterval(interval);
  }, [runCheck]);

  const isLoading = online === null;

  // Calculate uptime percentage from stored checks
  const uptimePercent =
    checks.length > 0
      ? ((checks.filter((c) => c.status === 'up').length / checks.length) * 100).toFixed(1)
      : '—';

  // Average response time
  const avgResponseMs =
    checks.length > 0
      ? Math.round(
          checks.filter((c) => c.status === 'up').reduce((s, c) => s + c.response_ms, 0) /
            Math.max(1, checks.filter((c) => c.status === 'up').length),
        )
      : 0;

  return (
    <div className="max-w-3xl flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Monitoring</h1>
        <p className="text-sm text-zinc-500 mt-1">Santé et disponibilité de l&apos;API</p>
      </div>

      {/* Big status indicator */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8">
        <div className="flex flex-col items-center text-center mb-8">
          {/* Pulsing circle */}
          <div className="relative mb-4">
            {!isLoading && online && (
              <div className="absolute inset-0 w-20 h-20 rounded-full bg-green-500/20 animate-ping" />
            )}
            <div
              className={[
                'relative w-20 h-20 rounded-full flex items-center justify-center',
                isLoading
                  ? 'bg-zinc-700 animate-pulse'
                  : online
                    ? 'bg-green-500 shadow-[0_0_40px_8px_rgba(34,197,94,0.3)]'
                    : 'bg-red-500 shadow-[0_0_40px_8px_rgba(239,68,68,0.3)]',
              ].join(' ')}
            >
              <span className="text-3xl text-white">
                {isLoading ? '?' : online ? '✓' : '✕'}
              </span>
            </div>
          </div>
          <h2 className="text-xl font-semibold text-white">
            {isLoading ? 'Vérification...' : online ? 'API en ligne' : 'API hors ligne'}
          </h2>
          <p className="text-sm text-zinc-500 mt-1">
            {isLoading
              ? 'Test de connexion en cours'
              : online
                ? 'Tous les systèmes fonctionnent normalement'
                : 'Le serveur ne répond pas'}
          </p>
        </div>

        {/* Info grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Response time */}
          <div className={`rounded-lg border p-4 ${isLoading ? 'bg-zinc-800/60 border-zinc-700' : responseTimeBg(responseMs)}`}>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-1">
              Temps de réponse
            </p>
            <p className={`text-2xl font-mono font-bold ${isLoading ? 'text-zinc-500' : responseTimeColor(responseMs)}`}>
              {isLoading ? '—' : `${responseMs}`}
            </p>
            {!isLoading && <p className="text-xs text-zinc-600 mt-0.5">ms</p>}
          </div>

          {/* Version */}
          <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/40 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-1">
              Version
            </p>
            <p className="text-2xl font-mono font-bold text-white">
              {isLoading ? '—' : health ? `v${health.version}` : '—'}
            </p>
          </div>

          {/* Uptime */}
          <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/40 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-1">
              Uptime
            </p>
            <p className="text-lg font-mono font-bold text-white leading-tight">
              {isLoading ? '—' : health ? formatUptime(health.uptime_seconds) : '—'}
            </p>
          </div>

          {/* BIC entries */}
          <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/40 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-1">
              Base BIC
            </p>
            <p className="text-2xl font-mono font-bold text-white">
              {isLoading ? '—' : health ? fmt(health.bic_database_entries) : '—'}
            </p>
            {!isLoading && health && (
              <p className="text-xs text-zinc-600 mt-0.5">entrées</p>
            )}
          </div>
        </div>
      </div>

      {/* Stats summary if online */}
      {health?.stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-center">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Opérations totales</p>
            <p className="text-xl font-mono font-bold text-amber-400">{fmt(health.stats.total_operations)}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-center">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Validations IBAN</p>
            <p className="text-xl font-mono font-bold text-white">{fmt(health.stats.iban_validations)}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-center">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Lookups BIC</p>
            <p className="text-xl font-mono font-bold text-white">{fmt(health.stats.bic_lookups)}</p>
          </div>
        </div>
      )}

      {/* Uptime bar — 30 days */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-medium text-zinc-300">Disponibilité — 30 jours</h2>
          <div className="flex items-center gap-3">
            {uptimePercent !== '—' && (
              <span className="text-xs font-mono text-green-400">{uptimePercent}% uptime</span>
            )}
            {lastChecked && (
              <span className="text-xs text-zinc-600">
                {lastChecked.toLocaleTimeString('fr-CH', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
            )}
          </div>
        </div>
        {avgResponseMs > 0 && (
          <p className="text-xs text-zinc-600 mb-4">
            Temps moyen : <span className={`font-mono ${responseTimeColor(avgResponseMs)}`}>{avgResponseMs} ms</span>
          </p>
        )}

        <UptimeBar checks={checks} />

        <div className="flex items-center gap-4 mt-3 text-xs text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500" />
            En ligne
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500" />
            Hors ligne
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-zinc-700" />
            Aucune donnée
          </span>
          <span className="ml-auto text-zinc-600">Auto-refresh: 60s</span>
        </div>
      </div>
    </div>
  );
}
