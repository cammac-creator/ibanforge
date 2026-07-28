import { cn } from '@/lib/utils';

/**
 * 'unknown' is not a fourth degree of risk, it is the absence of a verdict.
 *
 * The API can now answer risk_level 'unassessable' when the IBAN itself did not
 * validate, so there was nothing to screen. Rendering that as the 'low' chip
 * would reproduce, in the interface, the exact defect the API fix removed: the
 * playground is the first surface a prospect clicks, and a green chip on an
 * unscreened IBAN is worse than no chip at all.
 */
type Level = 'low' | 'med' | 'high' | 'unknown';

interface RiskChipProps {
  level?: Level;
  score: string | number;
  className?: string;
}

const styles: Record<Level, { color: string; bg: string; border: string }> = {
  low: { color: 'var(--risk-low-fg)', bg: 'var(--risk-low-bg)', border: 'var(--risk-low-bd)' },
  med: { color: 'var(--risk-med-fg)', bg: 'var(--risk-med-bg)', border: 'var(--risk-med-bd)' },
  high: { color: 'var(--risk-high-fg)', bg: 'var(--risk-high-bg)', border: 'var(--risk-high-bd)' },
  // Deliberately colourless: it must not read as any point on the scale.
  unknown: { color: 'var(--fg-2)', bg: 'var(--ink-4)', border: 'var(--ink-5)' },
};

/**
 * Compliance risk chip. Used on playground response cards, dashboard top-risk
 * countries, compare table. The 6px dot inherits color from the chip text.
 */
export function RiskChip({ level = 'low', score, className }: RiskChipProps) {
  const s = styles[level];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[6px] px-[10px] py-1 rounded-full font-mono text-xs font-medium uppercase tracking-caps border',
        className,
      )}
      style={{ color: s.color, background: s.bg, borderColor: s.border }}
    >
      <span className="w-[6px] h-[6px] rounded-full bg-current" />
      {level === 'unknown' ? 'non évalué' : level} · {score}
    </span>
  );
}
