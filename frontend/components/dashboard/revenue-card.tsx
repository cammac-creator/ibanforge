'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { InfoDot } from '@/components/dashboard/info-dot';

interface Tx {
  hash: string;
  from: string;
  value_usdc: number;
  time: string;
  explorer: string;
}

interface RevenueFull {
  balance_usdc: number | null;
  total_received_usdc?: number;
  transaction_count?: number;
  recent?: Tx[];
  chunks_failed?: number;
  chunks_total?: number;
}

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function RevenueCard() {
  const t = useTranslations('dashboard');
  const locale = useLocale();

  // undefined = still loading; null = error/unavailable; number = value
  const [balance, setBalance] = useState<number | null | undefined>(undefined);
  const [full, setFull] = useState<RevenueFull | null>(null);
  const [txLoading, setTxLoading] = useState(false);
  const [txErr, setTxErr] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/dashboard/revenue?mode=balance', { cache: 'no-store' });
        const d = await res.json();
        if (!alive) return;
        setBalance(res.ok ? (d.balance_usdc ?? null) : null);
      } catch {
        if (alive) setBalance(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const loadHistory = useCallback(async () => {
    setTxLoading(true);
    setTxErr(false);
    try {
      const res = await fetch('/api/dashboard/revenue?mode=full', { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok) setTxErr(true);
      else setFull(d);
    } catch {
      setTxErr(true);
    } finally {
      setTxLoading(false);
    }
  }, []);

  const fmtUsdc = (n: number | null | undefined): string =>
    n == null ? '—' : `${n.toLocaleString(locale, { maximumFractionDigits: 6 })}`;

  const recent = full?.recent ?? [];
  const partial = (full?.chunks_failed ?? 0) > 0;

  return (
    <div className="rounded-xl border border-[var(--ink-4)]/60 bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 p-5">
      <div className="mb-4 flex items-center gap-2">
        <p className="text-sm font-medium text-[var(--fg-2)]">{t('revenue.title')}</p>
        <InfoDot>{t('revenue.hint')}</InfoDot>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ---------- USDC rail ---------- */}
        <div className="rounded-lg border border-[var(--ink-4)]/80 bg-[var(--ink-2)]/40 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-4)]">
              {t('revenue.usdcRail')}
            </span>
            <span className="rounded-full bg-[var(--ok)]/10 px-2 py-0.5 text-[10px] font-mono font-semibold text-[var(--ok)]">
              {t('revenue.live')}
            </span>
          </div>

          <div className="mt-3">
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-bold text-amber-400">
                {balance === undefined ? '…' : fmtUsdc(balance)}
              </span>
              {balance !== undefined && balance !== null && (
                <span className="text-sm font-mono text-[var(--fg-4)]">USDC</span>
              )}
            </div>
            <p className="mt-1 text-xs text-[var(--fg-4)]">{t('revenue.liveBalance')}</p>
          </div>

          {/* transactions */}
          <div className="mt-4 border-t border-[var(--ink-4)]/60 pt-3">
            {!full && !txLoading && !txErr && (
              <button
                onClick={loadHistory}
                className="w-full rounded-lg border border-[var(--ink-5)]/70 bg-[var(--ink-4)]/40 px-3 py-2 text-xs font-medium text-[var(--fg-2)] transition-colors hover:bg-[var(--ink-4)] hover:text-white"
              >
                {t('revenue.loadHistory')}
              </button>
            )}

            {txLoading && (
              <div className="flex items-center gap-2 py-2 text-xs text-[var(--fg-4)]">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--fg-5)] border-t-amber-400" />
                {t('revenue.loading')}
              </div>
            )}

            {txErr && (
              <p className="py-1 text-xs text-[var(--fg-4)]">
                {t('revenue.error')}{' '}
                <span className="text-[var(--fg-5)]">{t('revenue.rpcHint')}</span>
              </p>
            )}

            {full && (
              <>
                <div className="mb-2 flex items-center justify-between text-[11px] text-[var(--fg-4)]">
                  <span>
                    {t('revenue.totalReceived')}:{' '}
                    <span className="font-mono text-[var(--fg-2)]">{fmtUsdc(full.total_received_usdc)} USDC</span>
                  </span>
                  <span className="font-mono">{full.transaction_count ?? recent.length} tx</span>
                </div>

                {recent.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    {recent.slice(0, 8).map((tx) => (
                      <a
                        key={tx.hash}
                        href={tx.explorer}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between rounded-md px-2 py-1 text-xs transition-colors hover:bg-[var(--ink-4)]/60"
                      >
                        <span className="font-mono text-[var(--fg-4)]">{shortAddr(tx.from)}</span>
                        <span className="flex items-center gap-3">
                          <span className="font-mono text-[var(--ok)]">+{fmtUsdc(tx.value_usdc)}</span>
                          <span className="text-[var(--fg-5)]">{tx.time.slice(0, 10)}</span>
                        </span>
                      </a>
                    ))}
                    {partial && <p className="mt-1 text-[10px] text-[var(--fg-5)]">{t('revenue.partial')}</p>}
                  </div>
                ) : (
                  <p className="text-xs text-[var(--fg-4)]">
                    {t('revenue.noTx')} <span className="text-[var(--fg-5)]">{t('revenue.rpcHint')}</span>
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {/* ---------- Stripe rail ---------- */}
        <div className="rounded-lg border border-[var(--ink-4)]/80 bg-[var(--ink-2)]/40 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-4)]">
              {t('revenue.stripeRail')}
            </span>
            <span className="rounded-full bg-[var(--ink-5)]/40 px-2 py-0.5 text-[10px] font-mono font-semibold text-[var(--fg-3)]">
              {t('revenue.stripeNotConfigured')}
            </span>
          </div>

          <div className="mt-3">
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-bold text-[var(--fg-5)]">—</span>
            </div>
            <p className="mt-1 text-xs text-[var(--fg-4)]">{t('revenue.stripeRailSub')}</p>
          </div>

          <div className="mt-4 border-t border-[var(--ink-4)]/60 pt-3">
            <p className="text-xs leading-relaxed text-[var(--fg-4)]">{t('revenue.stripeHint')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
