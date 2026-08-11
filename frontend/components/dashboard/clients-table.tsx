import { SEEDED_PILOT_RE } from '@/lib/crm/build-contacts';
import { InfoDot } from './info-dot';

/**
 * One row per EMAIL, fed by /v1/admin/activation. The whole point of this
 * table replacing the old per-key one: a buyer's pack lives on a separate key
 * whose monthly counter never moves, so the old `used/limit` reading showed
 * paying customers as "unused". Here the paid state wins and credits are the
 * figure shown.
 */
export interface ActivationClientRow {
  email: string;
  keys: Array<{ key_prefix: string; role: 'free' | 'paid'; active: number }>;
  signup_at: string;
  source: string;
  first_call_at: string | null;
  last_seen_at: string | null;
  calls_90d: number;
  free_used_month: number;
  free_quota: number;
  paywall_hits: number;
  credits_total: number;
  credits_remaining: number;
  packs: number;
  status: 'new' | 'active' | 'at-limit' | 'paying' | 'dormant' | 'silent';
}

const STATUS_STYLE: Record<ActivationClientRow['status'], { label: string; color: string; bg: string }> = {
  paying: { label: 'payant', color: '#22c55e', bg: '#052e16' },
  dormant: { label: 'endormi', color: '#f59e0b', bg: '#451a03' },
  'at-limit': { label: 'à la limite', color: '#ef4444', bg: '#450a0a' },
  active: { label: 'actif', color: '#3b82f6', bg: '#172554' },
  new: { label: 'nouveau', color: '#a78bfa', bg: '#2e1065' },
  silent: { label: 'silencieux', color: '#71717a', bg: '#27272a' },
};

const VISIBLE_ROWS = 25;

function daysSince(sql: string): number {
  return Math.floor((Date.now() - new Date(`${sql.replace(' ', 'T')}Z`).getTime()) / 86_400_000);
}

/** "3 h" under two days, "5 j" beyond — first-call delay after signup. */
function delayLabel(fromSql: string, toSql: string): string {
  const h = (new Date(`${toSql.replace(' ', 'T')}Z`).getTime() - new Date(`${fromSql.replace(' ', 'T')}Z`).getTime()) / 3_600_000;
  if (h < 1) return '< 1 h';
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} j`;
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(Math.round((value / max) * 100), 100) : 0;
  return (
    <div className="h-1.5 max-w-[110px] flex-1 overflow-hidden rounded-full bg-[var(--ink-4)]/60">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

export function ClientsTable({ clients, locale }: { clients: ActivationClientRow[]; locale: string }) {
  const fmt = (n: number) => n.toLocaleString(locale);
  const real = clients.filter((c) => !SEEDED_PILOT_RE.test(c.email));

  // Who deserves a nudge: paying customers gone quiet, and real signups that
  // never called. Seeded outreach keys are unused by construction and were
  // the old table's false "opportunities going cold" — kept out for good.
  const toChase = real.filter((c) => c.status === 'dormant' || c.status === 'silent');

  const visible = real.slice(0, VISIBLE_ROWS);
  const hidden = real.slice(VISIBLE_ROWS);
  const hiddenSummary = hidden.length
    ? Object.entries(
        hidden.reduce<Record<string, number>>((acc, c) => {
          acc[STATUS_STYLE[c.status].label] = (acc[STATUS_STYLE[c.status].label] ?? 0) + 1;
          return acc;
        }, {}),
      )
        .map(([label, n]) => `${n} ${label}`)
        .join(', ')
    : null;

  return (
    <div className="rounded-xl border border-[var(--ink-4)]/60 bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium text-[var(--fg-2)]">
          Clients — par adresse, crédits inclus
          <InfoDot>
            Une ligne par client (toutes ses clés agrégées). Les achats vivent sur une clé à crédits dont le compteur
            mensuel reste à zéro : ici l&rsquo;état payant gagne toujours, un acheteur ne peut plus apparaître « unused ».
            Comptes internes exclus.
          </InfoDot>
        </p>
        {toChase.length > 0 && (
          <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-400">
            {toChase.length} à relancer
          </span>
        )}
      </div>

      {toChase.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="mb-2 text-xs font-medium text-amber-300">
            ⚠ Payants endormis et inscrits restés silencieux — à relancer
          </p>
          <ul className="space-y-1">
            {toChase.slice(0, 8).map((c) => (
              <li key={c.email} className="text-xs text-amber-200">
                <span className="max-w-[280px] truncate align-bottom inline-block">{c.email}</span>{' '}
                <span className="text-amber-500/60">
                  ({STATUS_STYLE[c.status].label}
                  {c.packs > 0 ? `, ${fmt(c.credits_remaining)} crédits restants` : ''},{' '}
                  {c.last_seen_at ? `vu il y a ${daysSince(c.last_seen_at)} j` : `inscrit il y a ${daysSince(c.signup_at)} j`})
                </span>
              </li>
            ))}
            {toChase.length > 8 && (
              <li className="text-xs text-amber-500/60">… et {toChase.length - 8} autres dans la table.</li>
            )}
          </ul>
        </div>
      )}

      {real.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-sm text-[var(--fg-5)]">Aucun client externe.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--ink-4)] text-left text-xs uppercase tracking-wide text-[var(--fg-4)]">
                <th className="pb-2 font-medium">Client</th>
                <th className="pb-2 font-medium">Source</th>
                <th className="pb-2 font-medium">Inscrit</th>
                <th className="pb-2 font-medium">1er appel</th>
                <th className="pb-2 font-medium">Usage libre</th>
                <th className="pb-2 font-medium">Crédits</th>
                <th className="pb-2 font-medium">Statut</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const st = STATUS_STYLE[c.status];
                return (
                  <tr key={c.email} className="border-b border-[var(--ink-4)]/50 last:border-0">
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-1.5">
                        {c.packs > 0 && (
                          <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-400">
                            payant
                          </span>
                        )}
                        <span className="max-w-[240px] truncate text-[var(--fg-1)]" title={c.email}>
                          {c.email}
                        </span>
                        {c.keys.length > 1 && (
                          <span className="font-mono text-[10px] text-[var(--fg-5)]">×{c.keys.length}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-[var(--fg-3)]">{c.source}</td>
                    <td className="py-2.5 pr-3 text-xs text-[var(--fg-3)]">{daysSince(c.signup_at)} j</td>
                    <td className="py-2.5 pr-3 text-xs text-[var(--fg-3)]">
                      {c.first_call_at ? delayLabel(c.signup_at, c.first_call_at) : '—'}
                    </td>
                    <td className="py-2.5 pr-3">
                      {c.free_quota > 0 ? (
                        <div className="flex items-center gap-2">
                          <span className="w-20 font-mono text-xs text-[var(--fg-2)]">
                            {fmt(c.free_used_month)}/{fmt(c.free_quota)}
                          </span>
                          <Bar value={c.free_used_month} max={c.free_quota} color={st.color} />
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--fg-5)]">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      {c.packs > 0 ? (
                        <div className="flex items-center gap-2">
                          <span className="w-24 font-mono text-xs text-emerald-300">
                            {fmt(c.credits_remaining)}/{fmt(c.credits_total)}
                          </span>
                          <Bar value={c.credits_remaining} max={c.credits_total} color="#22c55e" />
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--fg-5)]">—</span>
                      )}
                    </td>
                    <td className="py-2.5">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={{ color: st.color, backgroundColor: st.bg }}
                      >
                        {st.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {hiddenSummary && (
            <p className="mt-2 text-xs text-[var(--fg-5)]">
              + {hidden.length} autres clients non affichés ({hiddenSummary}).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
