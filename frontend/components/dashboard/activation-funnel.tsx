import { InfoDot } from './info-dot';
// The arithmetic lives in lib/ because the frontend test runner collects
// lib/**/*.test.ts and app/**/*.test.ts only: a percentage computed inline in
// JSX is a percentage no test can reach, which is how "300 %" shipped.
import { medianLabel, stepPercent } from '@/lib/dashboard/activation-funnel-math';

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
  /**
   * Sample size behind each median. Optional so the page can keep feeding this
   * component the payload shape it already types; absent, the label simply
   * omits the n rather than inventing one. DASH-20, audit 2026-09-01.
   */
  median_n_signup_to_first_call?: number;
  median_n_first_call_to_purchase?: number;
}

const STEPS = [
  { key: 'signed_up', label: 'Inscrits', color: '#a78bfa' },
  { key: 'first_call', label: 'Ont appelé', color: '#3b82f6' },
  // DASH-07: the step counts 402/429 refusals SERVED INSIDE THE WINDOW. It used
  // to lean on the current calendar month's quota counter, so on the 1st it was
  // zero by construction and climbed back on its own as the month went on.
  { key: 'hit_limit', label: 'Ont été refusés (402/429)', color: '#f59e0b' },
  { key: 'purchased', label: 'Ont acheté', color: '#22c55e' },
] as const;

export function ActivationFunnel({ funnel }: { funnel: ActivationFunnelData }) {
  const max = Math.max(funnel.signed_up, 1);
  const values: Record<(typeof STEPS)[number]['key'], number> = {
    signed_up: funnel.signed_up,
    first_call: funnel.first_call,
    hit_limit: funnel.hit_limit,
    purchased: funnel.purchased,
  };
  const medians: Partial<Record<(typeof STEPS)[number]['key'], string | null>> = {
    first_call: medianLabel(funnel.median_hours_signup_to_first_call, funnel.median_n_signup_to_first_call),
    purchased: medianLabel(funnel.median_hours_first_call_to_purchase, funnel.median_n_first_call_to_purchase),
  };

  return (
    <div className="rounded-xl border border-[var(--ink-4)]/60 bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 p-5">
      <div className="mb-4 flex items-center gap-2">
        <p className="flex items-center gap-2 text-sm font-medium text-[var(--fg-2)]">
          Activation des inscrits — {funnel.period_days} jours
        </p>
        <InfoDot>
          Les personnes derrière les clés, pas le trafic : sur les inscrits de la période, combien ont fait un premier
          appel, été refusés faute de paiement ou de quota (402/429), puis acheté un pack. Chaque marche est comptée
          indépendamment sur la même population, et son pourcentage est donc rapporté aux INSCRITS, jamais à la marche
          du dessus : deux marches indépendantes n&rsquo;ont pas de rapport d&rsquo;inclusion, et diviser l&rsquo;une
          par l&rsquo;autre affichait « 300 % » sur « Ont acheté ». Les refus sont ceux servis DANS la fenêtre affichée.
          Les délais sont des médianes, suivies du nombre de clients sur lequel elles portent. Comptes internes et clés
          semées exclus côté API.
        </InfoDot>
      </div>

      <div className="flex flex-col gap-2">
        {STEPS.map((s, i) => {
          const v = values[s.key];
          // DASH-06 (audit 2026-09-01): the denominator is the population, not
          // the step above. These marches are counted independently ("ever
          // reached that state"), so a client can buy without ever being
          // refused — and 3 buyers over 1 refusal rendered a literal "300 %"
          // under a card that documents its own steps as independent.
          const pct = stepPercent(v, values.signed_up, i);
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
              <span className="w-44 shrink-0 text-xs text-[var(--fg-5)]">
                {pct !== null ? `${pct} % des inscrits` : ' '}
                {med ? ` · ${med}` : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
