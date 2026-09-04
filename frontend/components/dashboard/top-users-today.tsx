import type { TopUserToday } from '@/lib/crm/top-users';
import { InfoDot } from './info-dot';
import { ClientLinks } from './overview/client-links';

// Re-exported so a caller that draws the podium can name its rows without
// reaching past this file. The shape itself is declared where it is computed.
export type { TopUserToday };

const MEDALS = ['🥇', '🥈', '🥉'] as const;

const RANK_STYLE = [
  { border: 'border-amber-500/40', bg: 'bg-amber-500/[0.07]', num: 'text-amber-300' },
  { border: 'border-[var(--ink-5)]/60', bg: 'bg-[var(--ink-4)]/30', num: 'text-[var(--fg-1)]' },
  { border: 'border-[var(--ink-4)]/60', bg: 'bg-[var(--ink-2)]/40', num: 'text-[var(--fg-2)]' },
] as const;

const CAT_BADGE = {
  PAYANT: { label: 'payant', color: '#22c55e' },
  PILOTE: { label: 'pilote', color: '#3b82f6' },
  GRATUIT: { label: 'gratuit', color: '#a1a1aa' },
} as const;

/**
 * Compact hero card at the top of the CRM: top-3 API users. Ranked by today's
 * attributed requests (request_log per key, UTC day); when fewer than 3 clients
 * called today, backfilled with this month's most active clients (api_usage) so
 * the podium always shows real users — free tier included. Anonymous x402
 * traffic can't be attributed, internal accounts are excluded.
 */
export function TopUsersToday({
  top,
  todayUtc,
  locale,
}: {
  top: TopUserToday[];
  todayUtc: string;
  locale: string;
}) {
  const fmt = (n: number) => n.toLocaleString(locale);
  const dateLabel = new Date(`${todayUtc}T00:00:00Z`).toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  return (
    <div className="rounded-xl border border-amber-500/20 bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm" aria-hidden>
            🏆
          </span>
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-2)]">
            Top utilisateurs du jour
          </h2>
          <InfoDot>
            Classement par requêtes API d&rsquo;aujourd&rsquo;hui (attribution par clé, jour UTC).
            Quand moins de 3 clients ont appelé aujourd&rsquo;hui, complété par les plus actifs du
            mois (📅). Tous les clients comptent, gratuits inclus — seuls les comptes internes sont
            exclus. Le trafic x402 anonyme n&rsquo;est pas attribuable.
          </InfoDot>
        </div>
        <p className="text-[11px] text-[var(--fg-5)]">{dateLabel} · UTC</p>
      </div>

      {top.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--fg-4)]">
          Aucun client actif aujourd&rsquo;hui ni ce mois-ci — le podium se remplit au premier appel
          d&rsquo;une clé API.
        </p>
      ) : (
        <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
          {top.slice(0, 3).map((u, i) => {
            const st = RANK_STYLE[i];
            const cat = CAT_BADGE[u.category];
            return (
              <div
                key={u.email}
                className={`rounded-lg border px-2.5 py-1.5 ${st.border} ${st.bg}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-sm leading-none" aria-hidden>
                    {MEDALS[i]}
                  </span>
                  <span
                    className="truncate text-[13px] font-medium text-[var(--fg-1)]"
                    title={u.email}
                  >
                    {u.company ?? u.email}
                  </span>
                  <span className={`ml-auto shrink-0 font-mono text-sm font-bold ${st.num}`}>
                    {fmt(u.count)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 pl-6 text-[11px] uppercase tracking-wide">
                  <span className="flex items-center gap-1" style={{ color: cat.color }}>
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: cat.color }}
                    />
                    {cat.label}
                  </span>
                  <span className="text-[var(--fg-5)]">
                    {u.period === 'today' ? 'req aujourd’hui' : '📅 req ce mois-ci'}
                  </span>
                </div>
                {/* The three best users of the day are the three people most
                    worth a word today; a podium with no handle only decorates. */}
                <div className="mt-1.5 pl-6">
                  <ClientLinks locale={locale} email={u.email} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
