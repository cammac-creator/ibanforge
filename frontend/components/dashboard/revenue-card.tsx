'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { InfoDot } from '@/components/dashboard/info-dot';
import { formatGrouped } from '@/lib/format-grouped';
import { toZurich } from '@/lib/crm/zurich';
import { readWalletBalance, readWalletHistory, type WalletBalance, type WalletHistory } from '@/lib/dashboard/wallet-read';

function shortAddr(address: string): string { return `${address.slice(0, 6)}…${address.slice(-4)}`; }
function swissDate(stamp: string): string { return toZurich(stamp).slice(0, 16).replace('T', ' '); }

/** Le solde daté et l’union des transferts conservés restent distincts des ventes. */
export function RevenueCard({ refreshKey }: { refreshKey: string }) {
  const t = useTranslations('dashboard.revenue');
  const locale = useLocale();
  const [balance, setBalance] = useState<WalletBalance | null | undefined>(undefined);
  const [full, setFull] = useState<WalletHistory | null>(null);
  const [txLoading, setTxLoading] = useState(false);
  const [txErr, setTxErr] = useState(false);
  const requestController = useRef<AbortController | null>(null);
  const historyRequested = useRef(false);

  /** Une lecture remplacée ne peut plus réécrire le solde, même si elle finit plus tard. */
  const read = useCallback(async (mode: 'balance' | 'full') => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const timeout = setTimeout(() => controller.abort(), mode === 'full' ? 60_000 : 15_000);
    setBalance(undefined);
    setTxErr(false);
    if (mode === 'full') {
      setTxLoading(true);
      setFull(null);
    }
    try {
      const res = await fetch(`/api/dashboard/revenue?mode=${mode}`, { cache: 'no-store', signal: controller.signal });
      const payload: unknown = res.ok ? await res.json() : null;
      if (requestController.current !== controller) return;
      if (mode === 'full') {
        const data = readWalletHistory(payload);
        setFull(data);
        setTxErr(data === null);
        setBalance(data ? { balance_usdc: data.balance_usdc, read_at: data.read_at } : null);
      } else {
        setBalance(readWalletBalance(payload));
      }
    } catch {
      if (requestController.current === controller) {
        setBalance(null);
        if (mode === 'full') setTxErr(true);
      }
    } finally {
      clearTimeout(timeout);
      if (requestController.current === controller) {
        requestController.current = null;
        setTxLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    // L’instant change lors d’une actualisation volontaire ou d’une nouvelle vue serveur.
    // L’historique coûteux reste réservé à ceux qui l’ont déjà demandé dans cette vue.
    void read(historyRequested.current ? 'full' : 'balance');
    return () => {
      const controller = requestController.current;
      requestController.current = null;
      controller?.abort();
    };
  }, [refreshKey, read]);

  const loadHistory = () => {
    historyRequested.current = true;
    void read('full');
  };

  const fmt = (value: number | null | undefined): string => value == null
    ? '—' : formatGrouped(value, locale, 6).replace(/([.,]\d*?)0+$/, '$1').replace(/[.,]$/, '');
  const externalKnown = full?.received_external_usdc != null;
  return (
    <section data-wallet-card className="rounded-2xl border border-[var(--ink-4)] bg-[var(--ink-2)] p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <h3 className="text-base font-semibold text-[var(--fg-2)]">{t('title')}</h3>
        <InfoDot>{t('hint')}</InfoDot>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--ink-4)] p-4">
          <p className="text-xs text-[var(--fg-4)]">{t('liveBalance')}</p>
          <p data-wallet-balance className="mt-2 font-mono text-2xl font-semibold text-[var(--fg-1)] [overflow-wrap:anywhere]">
            {balance === undefined ? '…' : fmt(balance?.balance_usdc)} <span className="text-sm font-normal">USDC</span>
          </p>
          <p className="mt-2 text-xs leading-relaxed text-[var(--fg-4)]">
            {balance === undefined ? t('balanceLoading') : balance?.balance_usdc == null ? t('balanceUnavailable') : t('balanceNote')}
          </p>
          {balance && <p className="mt-2 text-xs text-[var(--fg-4)]">{t('readAt', { at: swissDate(balance.read_at) })}</p>}
        </div>
        <div className="rounded-xl border border-[var(--ink-4)] p-4">
          <p className="text-xs text-[var(--fg-4)]">{t('externalTitle')}</p>
          <p data-wallet-external className="mt-2 font-mono text-2xl font-semibold text-[var(--fg-1)] [overflow-wrap:anywhere]">
            {fmt(full?.received_external_usdc)} <span className="text-sm font-normal">USDC</span>
          </p>
          <p className="mt-2 text-xs leading-relaxed text-[var(--fg-4)]">
            {full === null ? t(txLoading ? 'loading' : 'historyNeeded') : !externalKnown ? t('externalUnknown') : t('externalNote')}
          </p>
        </div>
      </div>
      <div className="mt-4 border-t border-[var(--ink-4)] pt-3">
        <button onClick={loadHistory} disabled={txLoading} aria-busy={txLoading}
          className="min-h-11 rounded-lg border border-[var(--ink-5)] px-3 py-2 text-sm font-medium text-[var(--fg-2)] hover:bg-[var(--ink-4)] disabled:opacity-60">
          {txLoading ? t('loading') : full ? t('refreshHistory') : t('loadHistory')}
        </button>
        {txErr && <p role="alert" className="mt-2 text-sm text-[var(--warn)]">{t('error')}</p>}
        {full && !full.scan_complete && <p role="status" className="mt-2 text-sm text-[var(--warn)]">{t('partial')}</p>}
        {full && <div className="mt-4">
          <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm text-[var(--fg-3)]">
            <span>{t('totalReceived')} : <span className="font-mono">{fmt(full.total_received_usdc)} USDC</span></span>
            <span>{t('transactions', { count: full.transaction_count })}</span>
          </div>
          <p className="mb-2 text-xs leading-relaxed text-[var(--fg-4)]">{t('retainedScope')}</p>
          <p className="mb-2 text-xs text-[var(--fg-4)]">{t('readAt', { at: swissDate(full.read_at) })}</p>
          <p className="mb-3 text-xs leading-relaxed text-[var(--fg-4)]">{t('coverage', {
            succeeded: full.chunks_attempted - full.chunks_failed, total: full.chunks_total, failed: full.chunks_failed, skipped: full.chunks_skipped,
          })} {t('blockRange', { from: formatGrouped(full.block_range.from, locale), to: formatGrouped(full.block_range.to, locale) })}</p>
          {externalKnown && <p className="mb-3 text-xs text-[var(--fg-4)]">{t('internalShare', { amount: fmt(full.received_internal_usdc) })}</p>}
          {full.recent.length > 0 ? <>
            <p className="mb-2 text-xs text-[var(--fg-4)]">{t('estimatedDates')}</p>
            <div className="flex flex-col gap-1.5">
              {full.recent.slice(0, 8).map((tx) => <a key={tx.hash} href={tx.explorer} target="_blank" rel="noopener noreferrer"
                className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--ink-4)] px-3 py-2 text-xs hover:bg-[var(--ink-4)]">
                <span className="font-mono text-[var(--fg-4)]">{shortAddr(tx.from)}</span>
                <span className="flex flex-wrap gap-3"><span className="font-mono text-[var(--fg-2)]">+{fmt(tx.value_usdc)} USDC</span>
                  <span className="text-[var(--fg-4)]">{tx.time ? tx.time.slice(0, 10) : t('dateUnknown')}</span></span>
              </a>)}
            </div>
          </> : <p className="text-xs text-[var(--fg-4)]">{t('noTx')}</p>}
        </div>}
      </div>
    </section>
  );
}
