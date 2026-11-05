import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import styles from '../workspace.module.css';
import { getTranslations } from 'next-intl/server';
import type { ActivationClientRow } from '../clients-table';
import { OrphanMailPanel, type OrphanMailRow } from '../orphan-mail-panel';
import { ReservoirCard } from '../reservoir-card';
import type { BuildInput } from '@/lib/crm/build-contacts';
import { reservoir } from '@/lib/crm/priority';
import { HARD_CAP, SOFT_CAP } from '@/lib/crm/sent-today';
import { chaseQueue, type ChaseReason } from '@/lib/dashboard-overview';
import { ClientLinks } from './client-links';
import { FetchFailed, type Fetched } from './fetching';
import { snapshotOnce, writableIds } from './one-clock';
import { OverviewSection, overviewCard } from './section';
import { localePath } from '@/lib/locale-path';

/** Les conversations à traiter précèdent les signaux d’utilisation à examiner. */
const REASON_COLOR: Record<ChaseReason, string> = {
  'paid-dormant': 'text-red-300 border-red-500/30 bg-red-500/5',
  'at-limit': 'text-amber-300 border-amber-500/30 bg-amber-500/5',
  'gone-quiet': 'text-yellow-200/80 border-yellow-500/20 bg-yellow-500/5',
  'never-called': 'text-[var(--fg-3)] border-[var(--ink-5)] bg-[var(--ink-4)]/30',
};

function CounterLink({
  href,
  value,
  label,
  accent,
}: {
  href: string;
  value: number;
  label: string;
  accent?: string;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="group flex items-baseline min-h-11 gap-1.5 rounded px-1.5 py-2 transition-colors hover:bg-[var(--ink-4)]/50"
    >
      <span className={`font-mono text-base font-bold ${accent ?? 'text-[var(--fg-1)]'}`}>
        {value}
      </span>
      <span className="text-[12px] text-[var(--fg-4)] group-hover:text-[var(--fg-2)]">{label}</span>
      <span aria-hidden className="text-[11px] text-[var(--fg-5)] group-hover:text-[var(--fg-3)]">
        →
      </span>
    </Link>
  );
}

export async function ChaseSection({
  locale,
  nowIso,
  clientsPromise,
  crmPromise,
  orphanPromise,
}: {
  locale: string;
  /** The page's single instant: see one-clock.ts. */
  nowIso: string;
  clientsPromise: Promise<Fetched<ActivationClientRow[]>>;
  crmPromise: Promise<BuildInput | null>;
  orphanPromise: Promise<Fetched<{ orphans: OrphanMailRow[]; pending: number }>>;
}) {
  const t = await getTranslations('dashboard.overview');
  const [clientsRes, crm, orphanRes] = await Promise.all([
    clientsPromise,
    crmPromise,
    orphanPromise,
  ]);

  const queue = chaseQueue(clientsRes.data ?? [], new Date(nowIso));
  const snap = crm ? snapshotOnce(crm, nowIso) : null;
  const writable = snap ? writableIds(snap) : null;
  const tank = snap ? reservoir(snap.active) : null;

  const contacts = localePath(locale, '/dashboard/contacts');
  const clientsTab = localePath(locale, '/dashboard/clients');

  return (
    <OverviewSection step={3} title={t('chase.title')} lead={t('chase.lead')}>
      {snap && tank ? (
        <div className={styles.actionGrid}>
          {[
            {
              href: `${contacts}?vue=reponses`,
              value: snap.ballWithUs,
              label: 'ball',
              action: 'openReplies',
              priority: true,
            },
            {
              href: `${contacts}?vue=prospection`,
              value: tank.ready,
              label: 'ready',
              action: 'reviewDrafts',
              priority: false,
            },
            {
              href: `${contacts}?vue=enrichir`,
              value: tank.toEnrich,
              label: 'enrich',
              action: 'qualifyContacts',
              priority: false,
            },
          ].map((item) => (
            <Link
              key={item.label}
              href={item.href}
              prefetch={false}
              className={styles.actionCard}
              data-priority={item.priority}
            >
              <strong>{item.value}</strong>
              <span>{t(`chase.${item.label}`)}</span>
              <small>
                {t(`chase.${item.action}`)}
                <ArrowRight size={15} aria-hidden />
              </small>
            </Link>
          ))}
        </div>
      ) : (
        <p role="status" className={overviewCard}>
          {t('chase.crmDown')}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {snap && (
          <>
            <CounterLink
              href={`${contacts}?vue=relances`}
              value={snap.followupDue}
              label={t('chase.due')}
            />
            <CounterLink href={clientsTab} value={snap.freeActive} label={t('chase.freeActive')} />
            <CounterLink
              href={contacts}
              value={snap.sentToday}
              label={t(snap.sentToday >= HARD_CAP ? 'chase.sentCapped' : 'chase.sentToday')}
              accent={
                snap.sentToday >= HARD_CAP
                  ? 'text-red-400'
                  : snap.sentToday >= SOFT_CAP
                    ? 'text-amber-400'
                    : undefined
              }
            />
          </>
        )}
      </div>
      {orphanRes.data?.orphans && (
        <OrphanMailPanel orphans={orphanRes.data.orphans} totalPending={orphanRes.data.pending} />
      )}
      {!orphanRes.ok && <FetchFailed name={t('chase.orphan')} status={orphanRes.status} />}
      {!clientsRes.ok ? (
        <FetchFailed name={t('chase.accountsLabel')} status={clientsRes.status} />
      ) : (
        <details className={`${overviewCard} ${styles.review}`}>
          <summary>{t('chase.accounts', { count: queue.total })}</summary>
          <p className="mb-4 text-sm leading-relaxed text-[var(--fg-3)]">{t('chase.reviewNote')}</p>
          {queue.rows.length === 0 ? (
            <p className="text-sm text-emerald-400">{t('chase.empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--ink-4)]/50">
              {queue.rows.map((r) => (
                <li
                  key={r.email}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 first:pt-0 last:pb-0"
                >
                  <span
                    className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-semibold ${REASON_COLOR[r.reason]}`}
                  >
                    {t(`chase.reason.${r.reason}`)}
                  </span>
                  <span
                    className="min-w-0 flex-1 basis-40 truncate text-[13px] text-[var(--fg-1)]"
                    title={r.email}
                  >
                    {r.email}
                  </span>
                  <span className="shrink-0 text-[11px] text-[var(--fg-4)]">
                    {[
                      r.packs > 0 && r.creditsRemaining > 0
                        ? t('chase.creditsLeft', {
                            credits: r.creditsRemaining.toLocaleString(locale),
                          })
                        : null,
                      r.days !== null ? t('chase.days', { days: r.days }) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <ClientLinks
                    locale={locale}
                    email={r.email}
                    canWrite={writable === null || writable.has(r.email.toLowerCase())}
                  />
                </li>
              ))}
            </ul>
          )}

          {queue.total > queue.rows.length && (
            <p className="mt-3 text-xs text-[var(--fg-4)]">
              {t('chase.more', { count: queue.total - queue.rows.length })}
            </p>
          )}
        </details>
      )}
      {tank && snap && (
        <details className={`${overviewCard} ${styles.review}`}>
          <summary>{t('chase.reservoir')}</summary>
          <ReservoirCard
            reservoir={tank}
            todayUtc={snap.todayUtc}
            enrichHref={`${contacts}?vue=enrichir`}
          />
        </details>
      )}
    </OverviewSection>
  );
}
