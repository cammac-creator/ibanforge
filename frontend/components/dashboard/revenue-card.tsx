'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { InfoDot } from '@/components/dashboard/info-dot';
import { collected, type PacksSoldView, type OnChainView } from '@/lib/dashboard/revenue-view';

interface Tx {
  hash: string;
  from: string;
  value_usdc: number;
  time: string;
  explorer: string;
}

/** Mirrors PacksSold in src/lib/business-summary.ts. */
type PacksSold = PacksSoldView;

interface RevenueFull extends OnChainView {
  balance_usdc: number | null;
  /**
   * `received_external_usdc` (from OnChainView) is the settled figure minus our
   * own payer wallets. `null` when X402_INTERNAL_PAYERS is unset — which means
   * "cannot tell", NOT zero, and is rendered as such. DASH-02: the API has
   * computed it for months and the card never showed it, so the page displayed
   * a "total received" of which more than half came from our own test wallets.
   */
  internal_payers_configured?: boolean;
  transaction_count?: number;
  recent?: Tx[];
  chunks_failed?: number;
  chunks_total?: number;
  packs_sold?: PacksSold;
}

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/**
 * Revenue, told rail by rail — DASH-01 / DASH-02, audit 2026-09-01.
 *
 * 🚨 What this card used to say, and why every word of it was wrong:
 *   - the card half showed an em dash hard-coded in the JSX and a badge reading
 *     "Non configuré", while five credit packs had been sold, one of them on
 *     2026-08-27 with no matching USDC line in daily_stats — paid by the rail
 *     the page said did not exist;
 *   - the USDC half led with `balance_usdc`, a wallet BALANCE that goes DOWN
 *     when we spend, under a card titled "Revenus";
 *   - "Total reçu" mixed in our own test settlements, and the API's own
 *     `received_external_usdc` was never displayed.
 *
 * The rule this file now follows: NEVER print a total labelled "revenue" that
 * mixes an attempt with a receipt, or a balance with an income. Card dollars
 * and on-chain USDC are shown side by side and never summed — a single figure
 * would need an exchange rate and a date that nobody here has. A pack bought in
 * USDC is already inside the on-chain total, so it is counted there and only
 * named on the pack rail, never added twice.
 */
export function RevenueCard() {
  const t = useTranslations('dashboard');
  const locale = useLocale();

  // undefined = still loading; null = error/unavailable; number = value
  const [balance, setBalance] = useState<number | null | undefined>(undefined);
  const [packs, setPacks] = useState<PacksSold | null>(null);
  const [full, setFull] = useState<RevenueFull | null>(null);
  const [txLoading, setTxLoading] = useState(false);
  const [txErr, setTxErr] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/dashboard/revenue?mode=balance', { cache: 'no-store' });
        const d = (await res.json()) as RevenueFull;
        if (!alive) return;
        setBalance(res.ok ? (d.balance_usdc ?? null) : null);
        // Pack sales ride on the FAST call on purpose: the card rail must not
        // wait ~25 s of Transfer-log scanning before it stops claiming that no
        // card money exists.
        if (res.ok && d.packs_sold) setPacks(d.packs_sold);
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
      const d = (await res.json()) as RevenueFull;
      if (!res.ok) setTxErr(true);
      else {
        setFull(d);
        if (d.packs_sold) setPacks(d.packs_sold);
      }
    } catch {
      setTxErr(true);
    } finally {
      setTxLoading(false);
    }
  }, []);

  const fmtUsdc = (n: number | null | undefined): string =>
    n == null ? '—' : `${n.toLocaleString(locale, { maximumFractionDigits: 6 })}`;
  const fmtUsd = (n: number | null | undefined): string =>
    n == null ? '—' : `${n.toLocaleString(locale, { maximumFractionDigits: 2 })} $`;

  const recent = full?.recent ?? [];
  const partial = (full?.chunks_failed ?? 0) > 0;
  const { externalUsdc, externalKnown, cardUsd } = collected(packs, full);

  return (
    <div className="rounded-xl border border-[var(--ink-4)]/60 bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 p-5">
      <div className="mb-4 flex items-center gap-2">
        <p className="text-sm font-medium text-[var(--fg-2)]">{t('revenue.title')}</p>
        <InfoDot>
          Ce qui a été ENCAISSÉ, rail par rail, jamais ce qui a été tenté. Les dollars carte et les USDC réglés
          on-chain ne sont pas additionnés : ce serait inventer un taux et une date. Un pack payé en USDC est déjà
          compris dans le total on-chain, il n&rsquo;est donc que nommé sur le rail des packs. Le solde du wallet
          n&rsquo;est pas un revenu : il baisse quand on dépense.
        </InfoDot>
      </div>

      {/* ---------- the honest headline: what was collected ---------- */}
      <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 rounded-lg border border-[var(--ink-4)]/80 bg-[var(--ink-2)]/40 px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-4)]">Encaissé</span>
        <span className="flex items-baseline gap-1.5">
          <span className="font-mono text-2xl font-bold text-[var(--ok)]">
            {packs === null ? '…' : fmtUsd(cardUsd ?? 0)}
          </span>
          <span className="text-xs text-[var(--fg-4)]">packs par carte</span>
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="font-mono text-2xl font-bold text-amber-400">
            {full === null ? '—' : !externalKnown ? '?' : fmtUsdc(externalUsdc)}
          </span>
          <span className="text-xs text-[var(--fg-4)]">
            USDC réglés on-chain, hors nos propres portefeuilles
          </span>
        </span>
        {full !== null && !externalKnown && (
          <span className="text-[11px] text-[var(--fg-5)]">
            Part externe indéterminable : X402_INTERNAL_PAYERS n&rsquo;est pas renseigné, donc nos propres règlements
            ne peuvent pas être distingués. Total tous payeurs : {fmtUsdc(full.total_received_usdc)} USDC.
          </span>
        )}
        {full === null && (
          <span className="text-[11px] text-[var(--fg-5)]">
            Part USDC réglée : charge l&rsquo;historique on-chain ci-dessous.
          </span>
        )}
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
            <p className="mt-1 text-xs text-[var(--fg-4)]">
              {t('revenue.liveBalance')} — un solde, pas un revenu
            </p>
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
                <p className="mb-2 text-[11px] text-[var(--fg-5)]">
                  {!externalKnown
                    ? 'Dont part externe : indéterminable (payeurs internes non déclarés).'
                    : `Dont externe ${fmtUsdc(externalUsdc)} · à nous ${fmtUsdc(full.received_internal_usdc)}.`}
                  {(packs?.by_rail.usdc.count ?? 0) > 0 &&
                    ` ${packs?.by_rail.usdc.count} pack(s) payé(s) en USDC sont déjà compris dans ce total.`}
                </p>

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

        {/* ---------- credit packs sold (was: a hard-coded "Non configuré") ---------- */}
        <div className="rounded-lg border border-[var(--ink-4)]/80 bg-[var(--ink-2)]/40 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-4)]">
              Packs de crédits vendus
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold ${
                (packs?.count ?? 0) > 0
                  ? 'bg-[var(--ok)]/10 text-[var(--ok)]'
                  : 'bg-[var(--ink-5)]/40 text-[var(--fg-3)]'
              }`}
            >
              {packs === null ? '…' : `${packs.count} vendu${packs.count > 1 ? 's' : ''}`}
            </span>
          </div>

          <div className="mt-3">
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-bold text-[var(--ok)]">
                {packs === null ? '…' : fmtUsd(packs.usd)}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--fg-4)]">Encaissé sur les packs, tous rails confondus</p>
          </div>

          <div className="mt-4 flex flex-col gap-1.5 border-t border-[var(--ink-4)]/60 pt-3 text-xs">
            {packs === null ? (
              <p className="text-[var(--fg-4)]">Lecture des ventes…</p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--fg-4)]">Carte</span>
                  <span className="font-mono text-[var(--fg-2)]">
                    {fmtUsd(packs.by_rail.card.usd)} · {packs.by_rail.card.count} pack
                    {packs.by_rail.card.count > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--fg-4)]">USDC (x402)</span>
                  <span className="font-mono text-[var(--fg-2)]">
                    {fmtUsd(packs.by_rail.usdc.usd)} · {packs.by_rail.usdc.count} pack
                    {packs.by_rail.usdc.count > 1 ? 's' : ''}
                  </span>
                </div>
                {packs.by_rail.unknown.count > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--fg-4)]">Rail non enregistré</span>
                    <span className="font-mono text-[var(--fg-2)]">
                      {fmtUsd(packs.by_rail.unknown.usd)} · {packs.by_rail.unknown.count}
                    </span>
                  </div>
                )}
                {packs.granted_count > 0 && (
                  <p className="mt-1 text-[11px] text-[var(--fg-5)]">
                    {packs.granted_count} pack(s) offert(s), exclus du montant : un pack donné est un coût, pas une
                    recette.
                  </p>
                )}
                {packs.partly_deduced && (
                  <p className="mt-1 text-[11px] text-amber-400/90">
                    ⚠ {packs.deduced_count} de ces {packs.count} montants sont DÉDUITS du tarif des packs, faute d
                    &rsquo;un montant enregistré par le processeur : à lire comme une estimation, pas comme un reçu.
                  </p>
                )}
                {packs.last_sale_at && (
                  <p className="mt-1 text-[11px] text-[var(--fg-5)]">
                    Dernière vente : {packs.last_sale_at.slice(0, 10)}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
