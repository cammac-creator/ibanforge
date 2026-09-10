'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { InfoDot } from '@/components/dashboard/info-dot';
import { formatGrouped } from '@/lib/format-grouped';
import type { OnChainView } from '@/lib/dashboard/revenue-view';

interface Tx {
  hash: string;
  from: string;
  value_usdc: number;
  time: string;
  explorer: string;
}

interface RevenueFull extends OnChainView {
  balance_usdc: number | null;
  transaction_count?: number;
  recent?: Tx[];
  chunks_failed?: number;
  chunks_total?: number;
}

function shortAddr(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** Le portefeuille reste une lecture distincte des paiements de packs conservés dans l’API. */
export function RevenueCard() {
  const t = useTranslations('dashboard.revenue');
  const locale = useLocale();
  // Une lecture en cours, une lecture impossible et un zéro connu restent distincts.
  const [balance, setBalance] = useState<number | null | undefined>(undefined);
  const [full, setFull] = useState<RevenueFull | null>(null);
  const [txLoading, setTxLoading] = useState(false);
  const [txErr, setTxErr] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/dashboard/revenue?mode=balance', { cache: 'no-store' });
        const data = (await res.json()) as RevenueFull;
        if (alive) setBalance(res.ok ? (data.balance_usdc ?? null) : null);
      } catch {
        if (alive) setBalance(null);
      }
    })();
    return () => { alive = false; };
  }, []);

  const loadHistory = useCallback(async () => {
    setTxLoading(true);
    setTxErr(false);
    try {
      const res = await fetch('/api/dashboard/revenue?mode=full', { cache: 'no-store' });
      const data = (await res.json()) as RevenueFull;
      if (!res.ok) setTxErr(true);
      else setFull(data);
    } catch {
      setTxErr(true);
    } finally {
      setTxLoading(false);
    }
  }, []);

  const fmt = (value: number | null | undefined): string => value == null || !Number.isFinite(value)
    ? '—'
    : formatGrouped(value, locale, 6).replace(/([.,]\d*?)0+$/, '$1').replace(/[.,]$/, '');
  const recent = full?.recent ?? [];
  const partial = (full?.chunks_failed ?? 0) > 0;
  const external = full?.received_external_usdc;
  const externalKnown = external != null && Number.isFinite(external);

  return (
    <div className="rounded-xl border border-[var(--ink-4)]/60 bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 p-5">
      <div className="mb-4 flex items-center gap-2">
        <h3 className="text-sm font-medium text-[var(--fg-2)]">{t('title')}</h3>
        <InfoDot>{t('hint')}</InfoDot>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-[var(--ink-4)]/80 bg-[var(--ink-2)]/40 p-4">
          <p className="text-xs text-[var(--fg-4)]">{t('liveBalance')}</p>
          <p className="mt-2 font-mono text-xl font-bold text-amber-400 [overflow-wrap:anywhere] sm:text-2xl">
            {balance === undefined ? '…' : fmt(balance)} <span className="text-sm font-normal">USDC</span>
          </p>
          <p className="mt-2 text-[11px] text-[var(--fg-5)]">
            {balance === null ? t('balanceUnavailable') : t('balanceNote')}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--ink-4)]/80 bg-[var(--ink-2)]/40 p-4">
          <p className="text-xs text-[var(--fg-4)]">{t('externalTitle')}</p>
          <p className="mt-2 font-mono text-xl font-bold text-[var(--ok)] [overflow-wrap:anywhere] sm:text-2xl">
            {full === null ? '—' : externalKnown ? fmt(external) : '?'} <span className="text-sm font-normal">USDC</span>
          </p>
          <p className="mt-2 text-[11px] text-[var(--fg-5)]">
            {full === null ? t('historyNeeded') : !externalKnown ? t('externalUnknown') : t('externalNote')}
          </p>
        </div>
      </div>

      <div className="mt-4 border-t border-[var(--ink-4)]/60 pt-3">
        <button onClick={loadHistory} disabled={txLoading}
          className="rounded-lg border border-[var(--ink-5)]/70 bg-[var(--ink-4)]/40 px-3 py-2 text-xs font-medium text-[var(--fg-2)] transition-colors hover:bg-[var(--ink-4)] hover:text-white disabled:opacity-60">
          {txLoading ? t('loading') : full ? t('refreshHistory') : t('loadHistory')}
        </button>
        {txErr ? <p role="alert" className="mt-2 text-xs text-amber-300">{t('error')}</p> : null}
        {partial ? <p className="mt-2 text-xs text-amber-300">{t('partial')}</p> : null}
        {full ? (
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--fg-4)]">
              <span>{t('totalReceived')} : <span className="font-mono text-[var(--fg-2)]">{fmt(full.total_received_usdc)} USDC</span></span>
              <span>{t('transactions', { count: full.transaction_count ?? recent.length })}</span>
            </div>
            <p className="mb-3 text-[11px] text-[var(--fg-5)]">{t('retainedScope')}</p>
            {externalKnown ? <p className="mb-3 text-[11px] text-[var(--fg-5)]">{t('internalShare', { amount: fmt(full.received_internal_usdc) })}</p> : null}
            {recent.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {recent.slice(0, 8).map((tx) => (
                  <a key={tx.hash} href={tx.explorer} target="_blank" rel="noopener noreferrer"
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1 text-xs transition-colors hover:bg-[var(--ink-4)]/60">
                    <span className="font-mono text-[var(--fg-4)]">{shortAddr(tx.from)}</span>
                    <span className="flex items-center gap-3">
                      <span className="font-mono text-[var(--ok)]">+{fmt(tx.value_usdc)}</span>
                      <span className="text-[var(--fg-5)]">{tx.time.slice(0, 10)}</span>
                    </span>
                  </a>
                ))}
              </div>
            ) : <p className="text-xs text-[var(--fg-4)]">{t('noTx')}</p>}
          </div>
        ) : null}
      </div>
    </div>
  );
}
