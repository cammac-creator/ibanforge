import Link from 'next/link';
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

/**
 * Section 2 — who to chase today.
 *
 * The change with the most value in the whole rebuild. Before it, the answer
 * to "who do I write to this morning" was spread over five places that all
 * printed a COUNT and offered no verb: a badge on a table, a tile in a row of
 * technical health figures, another tile two thousand pixels up, an amber
 * banner naming customers with no button beside them, and the real gesture two
 * tabs away. The cockpit stated the work and did not let it be done.
 *
 * It is one ranked queue now, each row carrying the reason in plain words and
 * two links. Nothing is ever sent from here: "écrire" opens the thread where
 * the whole file is on screen, which is where the decision belongs.
 */

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
      className="group flex items-baseline gap-1.5 rounded px-1.5 py-0.5 transition-colors hover:bg-[var(--ink-4)]/50"
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

  const contacts = `/${locale}/dashboard/contacts`;
  const clientsTab = `/${locale}/dashboard/clients`;

  return (
    <OverviewSection
      step={2}
      title={t('chase.title')}
      lead={t('chase.lead')}
      aside={
        queue.total > queue.rows.length ? (
          <span className="text-[11px] text-[var(--fg-5)]">
            {t('chase.more', { count: queue.total - queue.rows.length })}
          </span>
        ) : null
      }
    >
      <div className={overviewCard}>
        {!clientsRes.ok ? (
          <FetchFailed name={t('chase.title')} status={clientsRes.status} />
        ) : queue.rows.length === 0 ? (
          <p className="text-sm text-emerald-400">{t('chase.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--ink-4)]/50">
            {queue.rows.map((r) => (
              <li
                key={r.email}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 first:pt-0 last:pb-0"
              >
                {/* 11px and no capitals: « a appelé puis s'est tu » is twenty-two
                    characters, and capitals with tracking at 10px turned the one
                    word that says why a row is here into a texture. */}
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

        {/* The counters that used to be six mute tiles (ENS-16, ENS-24). Each
            one is a link now, which is the whole difference between a table
            and a workstation. */}
        <div className="mt-3 flex flex-wrap items-baseline gap-x-1 gap-y-1 border-t border-[var(--ink-4)]/60 pt-2.5">
          {snap ? (
            <>
              {/* Each counter lands on the rows it counts: the URL carries the
                  work tile, so « 68 relances dues » opens the 68 and not the
                  whole base with a tile still to find and press. */}
              <CounterLink
                href={`${contacts}?vue=reponses`}
                value={snap.ballWithUs}
                label={t('chase.ball')}
                accent="text-blue-400"
              />
              <CounterLink
                href={`${contacts}?vue=relances`}
                value={snap.followupDue}
                label={t('chase.due')}
                accent="text-amber-400"
              />
              <CounterLink
                href={`${contacts}?vue=prospection`}
                value={tank?.ready ?? 0}
                label={t('chase.ready')}
                accent="text-teal-400"
              />
              <CounterLink
                href={clientsTab}
                value={snap.freeActive}
                label={t('chase.freeActive')}
                accent="text-yellow-400"
              />
              {/* The day's cadence, in the block that proposes the day's work.
                  It used to be said only in the Contacts header, so the cap was
                  discovered with a mail already written and a button gone grey.
                  Amber from the soft cap, red at the hard one. */}
              <CounterLink
                href={contacts}
                value={snap.sentToday}
                label={t(snap.sentToday >= HARD_CAP ? 'chase.sentCapped' : 'chase.sentToday')}
                accent={
                  snap.sentToday >= HARD_CAP
                    ? 'text-red-400'
                    : snap.sentToday >= SOFT_CAP
                      ? 'text-amber-400'
                      : 'text-[var(--fg-2)]'
                }
              />
            </>
          ) : (
            <p className="text-[12px] text-[var(--fg-5)]">{t('chase.crmDown')}</p>
          )}
        </div>
      </div>

      {/* Sized rather than gridded: a two-column grid holding one card is how
          the old page grew its columns of black (ENS-19). */}
      {tank && snap && (
        <div className="sm:max-w-sm">
          <ReservoirCard reservoir={tank} todayUtc={snap.todayUtc} />
        </div>
      )}

      {/* Mail nobody owns, with its three real buttons — the only block on the
          old overview that already let the operator act. */}
      {orphanRes.data?.orphans && orphanRes.data.orphans.length > 0 && (
        <OrphanMailPanel orphans={orphanRes.data.orphans} totalPending={orphanRes.data.pending} />
      )}
    </OverviewSection>
  );
}
