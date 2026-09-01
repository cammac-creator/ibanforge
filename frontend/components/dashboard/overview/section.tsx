import type { ReactNode } from 'react';
import { InfoDot } from '../info-dot';

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
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b border-[var(--ink-4)]/60 pb-1.5">
        <span
          aria-hidden
          className="font-mono text-[11px] font-bold text-[var(--fg-5)]"
        >
          {step}
        </span>
        <h2 className="text-[15px] font-semibold text-white">{title}</h2>
        {hint && <InfoDot>{hint}</InfoDot>}
        {lead && <p className="text-[12px] text-[var(--fg-4)]">{lead}</p>}
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
