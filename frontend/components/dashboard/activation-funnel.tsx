import { InfoDot } from './info-dot';

/**
 * The HUMAN funnel: signups of the period, and how far each got. Steps are
 * counted independently over the same population ("ever reached that state"),
 * so a client who bought without hitting the limit still counts in purchased.
 * This is the conversion picture the business runs on — the HTTP funnel below
 * it measures machine demand, not people.
 */
export interface ActivationFunnelData {
  period_days: number;
  signed_up: number;
  first_call: number;
  hit_limit: number;
  purchased: number;
  median_hours_signup_to_first_call: number | null;
  median_hours_first_call_to_purchase: number | null;
}

const STEPS = [
  { key: 'signed_up', label: 'Inscrits', color: '#a78bfa' },
  { key: 'first_call', label: 'Ont appelé', color: '#3b82f6' },
  { key: 'hit_limit', label: 'Ont touché la limite', color: '#f59e0b' },
  { key: 'purchased', label: 'Ont acheté', color: '#22c55e' },
] as const;

function medianLabel(hours: number | null): string | null {
  if (hours === null) return null;
  if (hours < 1) return '< 1 h';
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round((hours / 24) * 10) / 10} j`;
}

export function ActivationFunnel({ funnel }: { funnel: ActivationFunnelData }) {
  const max = Math.max(funnel.signed_up, 1);
  const values: Record<(typeof STEPS)[number]['key'], number> = {
    signed_up: funnel.signed_up,
    first_call: funnel.first_call,
    hit_limit: funnel.hit_limit,
    purchased: funnel.purchased,
  };
  const medians: Partial<Record<(typeof STEPS)[number]['key'], string | null>> = {
    first_call: medianLabel(funnel.median_hours_signup_to_first_call),
    purchased: medianLabel(funnel.median_hours_first_call_to_purchase),
  };

  return (
    <div className="rounded-xl border border-[var(--ink-4)]/60 bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 p-5">
      <div className="mb-4 flex items-center gap-2">
        <p className="flex items-center gap-2 text-sm font-medium text-[var(--fg-2)]">
          Activation des inscrits — {funnel.period_days} jours
        </p>
        <InfoDot>
          Les personnes derrière les clés, pas le trafic : sur les inscrits de la période, combien ont fait un premier
          appel, touché leur limite (quota ou refus 402/429), puis acheté un pack. Chaque marche est comptée
          indépendamment sur la même population. Les délais sont des médianes. Comptes internes et clés semées exclus
          côté API.
        </InfoDot>
      </div>

      <div className="flex flex-col gap-2">
        {STEPS.map((s, i) => {
          const v = values[s.key];
          const prev = i > 0 ? values[STEPS[i - 1].key] : null;
          const pct = prev !== null && prev > 0 ? Math.round((v / prev) * 100) : null;
          const width = Math.max((v / max) * 100, v > 0 ? 3 : 0);
          const med = medians[s.key];
          return (
            <div key={s.key} className="flex items-center gap-3">
              <span className="w-40 shrink-0 text-right text-xs text-[var(--fg-3)]">{s.label}</span>
              <div className="relative h-6 flex-1 overflow-hidden rounded bg-[var(--ink-4)]/40">
                <div
                  className="flex h-full items-center rounded pl-2"
                  style={{ width: `${width}%`, backgroundColor: `${s.color}33`, borderLeft: `3px solid ${s.color}` }}
                >
                  <span className="font-mono text-xs font-semibold" style={{ color: s.color }}>
                    {v}
                  </span>
                </div>
              </div>
              <span className="w-28 shrink-0 text-xs text-[var(--fg-5)]">
                {pct !== null ? `${pct} %` : ' '}
                {med ? ` · ${med}` : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
