/**
 * The arithmetic of the activation funnel, pulled out of the component so it
 * can be tested — audit DASH-06 / DASH-20, 2026-09-01.
 *
 * The bug this exists to prevent was three characters wide and lived in JSX,
 * where the frontend test runner does not look: the card divided each step by
 * the step ABOVE it, while its own docstring says the steps are counted
 * independently over one population. With four signups, one refusal and three
 * buyers, the last step rendered a literal "300 %".
 */

export interface FunnelValues {
  signed_up: number;
  first_call: number;
  hit_limit: number;
  purchased: number;
}

/**
 * A step as a share of the POPULATION, never of the step above.
 *
 * `null` for the first step (a population is not a share of itself) and
 * whenever there is no population to divide by. Independent steps have no
 * inclusion relation, so step-over-previous-step is not a conversion rate: it
 * is a ratio between two unrelated counts, and it can exceed 100.
 */
export function stepPercent(value: number, signedUp: number, index: number): number | null {
  if (index === 0) return null;
  if (signedUp <= 0) return null;
  return Math.round((value / signedUp) * 100);
}

/**
 * A median delay, with the sample size it rests on.
 *
 * DASH-20: both medians drop any delay below zero, so a buyer whose credit key
 * predates their first call leaves the sample silently — and "< 1 h" reads the
 * same over two clients and over none. `n` is what tells those apart; it is
 * omitted, not invented, when the caller has none.
 */
export function medianLabel(hours: number | null, n?: number): string | null {
  if (hours === null) return null;
  const suffix = n === undefined ? '' : `, n = ${n}`;
  if (hours < 1) return `< 1 h${suffix}`;
  if (hours < 48) return `${Math.round(hours)} h${suffix}`;
  return `${Math.round((hours / 24) * 10) / 10} j${suffix}`;
}
