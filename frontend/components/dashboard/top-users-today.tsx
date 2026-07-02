import { InfoDot } from './info-dot';

export interface TopUserToday {
  email: string;
  company: string | null;
  sector: string | null;
  category: 'PAYANT' | 'PILOTE' | 'GRATUIT';
  count: number;
}

const MEDALS = ['🥇', '🥈', '🥉'] as const;

const RANK_STYLE = [
  { border: 'border-amber-500/40', bg: 'bg-amber-500/[0.07]', num: 'text-amber-300', bar: '#f59e0b' },
  { border: 'border-zinc-700/60', bg: 'bg-zinc-800/30', num: 'text-zinc-200', bar: '#a1a1aa' },
  { border: 'border-zinc-800/60', bg: 'bg-zinc-900/40', num: 'text-zinc-300', bar: '#b45309' },
] as const;

const CAT_BADGE = {
  PAYANT: { label: 'Payant', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  PILOTE: { label: 'Pilote', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  GRATUIT: { label: 'Gratuit', color: '#a1a1aa', bg: 'rgba(161,161,170,0.12)' },
} as const;

/**
 * Hero card at the top of the CRM: today's top-3 API users (by attributed
 * request count). Attribution comes from request_log.key_prefix, so only
 * key-authenticated calls count — anonymous x402 traffic can't be ranked.
 */
export function TopUsersToday({ top, todayUtc, locale }: { top: TopUserToday[]; todayUtc: string; locale: string }) {
  const fmt = (n: number) => n.toLocaleString(locale);
  const dateLabel = new Date(`${todayUtc}T00:00:00Z`).toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const max = top[0]?.count ?? 0;

  return (
    <div className="relative overflow-hidden rounded-xl border border-amber-500/20 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 h-52 w-52 rounded-full bg-amber-500/10 blur-3xl" />
      <div className="relative">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-lg" aria-hidden>
              🏆
            </span>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">Top utilisateurs du jour</h2>
            <InfoDot>
              Classement des clients (hors comptes internes) par nombre de requêtes API aujourd&rsquo;hui, toutes clés
              confondues. Source : attribution par clé dans request_log, jour UTC. Le trafic x402 anonyme n&rsquo;est pas
              attribuable à un client.
            </InfoDot>
          </div>
          <p className="text-xs text-zinc-500">
            {dateLabel} <span className="text-zinc-600">· jour UTC</span>
          </p>
        </div>

        {top.length === 0 ? (
          <div className="mt-4">
            <p className="text-sm text-zinc-500">Aucune requête attribuée à un client aujourd&rsquo;hui pour l&rsquo;instant.</p>
            <p className="mt-1 text-[11px] text-zinc-600">
              Le classement se remplit dès qu&rsquo;une clé API (gratuite ou crédits) fait un appel — le jour repart à minuit UTC.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => {
              const u = top[i];
              const st = RANK_STYLE[i];
              if (!u) {
                return (
                  <div
                    key={i}
                    className="flex min-h-[92px] items-center justify-center rounded-lg border border-dashed border-zinc-800/60 p-3 text-xs text-zinc-600"
                  >
                    {MEDALS[i]} place libre
                  </div>
                );
              }
              const cat = CAT_BADGE[u.category];
              const pct = max > 0 ? Math.max(4, Math.round((u.count / max) * 100)) : 0;
              return (
                <div key={u.email} className={`rounded-lg border p-3 ${st.border} ${st.bg}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xl leading-none" aria-hidden>
                      {MEDALS[i]}
                    </span>
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase"
                      style={{ color: cat.color, backgroundColor: cat.bg }}
                    >
                      {cat.label}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-sm font-medium text-zinc-200" title={u.email}>
                    {u.company ?? u.email}
                  </p>
                  <p className="truncate text-[10px] text-zinc-500">{u.company ? u.email : (u.sector ?? ' ')}</p>
                  <p className={`mt-1.5 font-mono text-2xl font-bold leading-none ${st.num}`}>
                    {fmt(u.count)} <span className="text-xs font-normal text-zinc-500">req</span>
                  </p>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: st.bar }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
