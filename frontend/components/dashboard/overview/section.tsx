import type { ReactNode } from 'react';
import { InfoDot } from '../info-dot';
import { Activity, ChartNoAxesCombined, CircleDollarSign, ListChecks, Sparkles, SlidersHorizontal } from 'lucide-react';
import styles from '../workspace.module.css';

/**
 * The cockpit's section shell.
 *
 * The overview answers five morning questions in order, and each one is a
 * titled band rather than one more card in a stack of twenty-two. The number
 * is on screen on purpose: the order IS the doctrine (money, who to chase,
 * what is broken, what is new, the rest), and a reader who sees "3" knows
 * without counting that two more important things are above.
 */
export function OverviewSection({
  step,
  title,
  lead,
  hint,
  aside,
  children,
}: {
  step: number;
  title: string;
  lead?: string;
  hint?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const Icon = [CircleDollarSign, ChartNoAxesCombined, ListChecks, Activity, Sparkles, SlidersHorizontal][step - 1] ?? Activity;
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}>
        <span className={styles.sectionIcon} aria-hidden><Icon size={17} /></span>
        <h2>{title}</h2>
        {hint && <InfoDot>{hint}</InfoDot>}
        {lead && <p className={styles.sectionLead}>{lead}</p>}
        {aside && <div className="ml-auto flex items-center gap-2">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** The card chrome every dashboard block already wears, named once. */
export const overviewCard =
  'rounded-xl border border-[var(--ink-4)]/60 bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 p-5';

/**
 * A section that is not there yet.
 *
 * The overview pays the whole cost of a cold upstream (measured at about three
 * seconds on 01/09/2026 against half a second for every other tab) and, with
 * neither a loading.tsx nor a Suspense boundary, the App Router held the
 * PREVIOUS screen still for all of it: clicking "Vue d'ensemble" looked like a
 * click that did nothing. These bars are what moves instead.
 */
export function SectionSkeleton({ rows = 1, tall = false }: { rows?: number; tall?: boolean }) {
  return (
    <div className="flex animate-pulse flex-col gap-3" aria-hidden>
      <div className="h-3 w-40 rounded bg-[var(--ink-4)]/70" />
      <div className={`grid gap-4 ${rows > 1 ? 'sm:grid-cols-2 lg:grid-cols-4' : ''}`}>
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className={`${tall ? 'h-40' : 'h-20'} rounded-xl border border-[var(--ink-4)]/40 bg-[var(--ink-2)]/50`}
          />
        ))}
      </div>
    </div>
  );
}
