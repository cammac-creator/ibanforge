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
    // Keep only the last 30 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const filtered = checks.filter(
      (c) => new Date(c.date) >= cutoff,
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // SSR safety — localStorage unavailable
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}j`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0 || parts.length === 0) parts.push(`${mins}m`);
  return parts.join(' ');
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
    // Load history from localStorage on mount
    const stored = loadChecks();
    setChecks(stored);

    // First check immediately
    runCheck();

    // Auto-refresh every 60 seconds
    const interval = setInterval(runCheck, 60_000);
    return () => clearInterval(interval);
  }, [runCheck]);

  const isLoading = online === null;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-white mb-6">Monitoring</h1>

      {/* Status card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-4">
        <div className="flex items-center gap-4 mb-6">
          {/* Status circle */}
          <div
            className={[
              'w-5 h-5 rounded-full flex-shrink-0',
              isLoading
                ? 'bg-zinc-600 animate-pulse'
                : online
                  ? 'bg-green-500 shadow-[0_0_12px_2px_rgba(34,197,94,0.5)]'
                  : 'bg-red-500 shadow-[0_0_12px_2px_rgba(239,68,68,0.5)]',
            ].join(' ')}
          />
          <span className="text-xl font-semibold text-white">
            {isLoading ? 'Vérification…' : online ? 'API Online' : 'API Offline'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Response time */}
          <div className="bg-zinc-800/60 rounded-lg p-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">
              Temps de réponse
            </p>
            <p className="text-2xl font-mono font-semibold text-white">
              {isLoading ? '—' : `${responseMs} ms`}
            </p>
          </div>

          {/* API version */}
          <div className="bg-zinc-800/60 rounded-lg p-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">
              Version API
            </p>
            <p className="text-2xl font-mono font-semibold text-white">
              {isLoading ? '—' : health ? `v${health.version}` : '—'}
            </p>
          </div>

          {/* Uptime since */}
          <div className="bg-zinc-800/60 rounded-lg p-4 col-span-2">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">
              Uptime actuel
            </p>
            <p className="text-2xl font-mono font-semibold text-white">
              {isLoading
                ? '—'
                : health
                  ? formatUptime(health.uptime_seconds)
                  : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Uptime bar — 30 days */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-zinc-300">
            Historique 30 jours
          </h2>
          {lastChecked && (
            <span className="text-xs text-zinc-500">
              Mis à jour{' '}
              {lastChecked.toLocaleTimeString('fr-CH', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
          )}
        </div>

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
        </div>
      </div>
    </div>
  );
}
