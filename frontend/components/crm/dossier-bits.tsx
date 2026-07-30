'use client';

/**
 * The pieces both dossier panels are made of. Extracted when the Clients Bot
 * tab arrived: two panels drawing the same bar and the same day strip from two
 * copies would drift the first time one of them was tuned.
 */

/** ISO 3166-1 alpha-2 → flag emoji. Anything else renders as the raw code. */
export function flag(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function relativeDays(days: number | null): string {
  if (days == null) return 'jamais';
  if (days === 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 31) return `il y a ${days} j`;
  const months = Math.round(days / 30);
  return `il y a ${months} mois`;
}

export function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h4 className="mb-2 flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-4)]">
        {title}
        {note && <span className="font-normal normal-case tracking-normal text-[var(--fg-5)]">{note}</span>}
      </h4>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs italic text-[var(--fg-5)]">{children}</p>;
}

/** A labelled proportional bar. `max` is the row that defines full width. */
export function Bar({ label, value, max, tone = 'amber' }: { label: string; value: number; max: number; tone?: 'amber' | 'sky' }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  const color = tone === 'amber' ? 'var(--amber-500)' : 'var(--info)';
  return (
    <div className="flex items-center gap-2 py-[3px]">
      <span className="w-40 shrink-0 truncate font-mono text-[11px] text-[var(--fg-3)]" title={label}>
        {label}
      </span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--ink-4)]">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </span>
      <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-[var(--fg-2)]">{value}</span>
    </div>
  );
}

/** 90-day call history. Bars, not a line: most customers have gaps, and a line implies days they did not call. */
export function Sparkbars({ days }: { days: Array<{ day: string; count: number }> }) {
  if (days.length === 0) return <Empty>Aucun appel sur la période.</Empty>;
  const max = Math.max(...days.map((d) => d.count));
  return (
    <div className="flex h-14 items-end gap-[2px]" aria-hidden>
      {days.map((d) => (
        <span
          key={d.day}
          title={`${d.day} — ${d.count}`}
          className="min-w-[3px] flex-1 rounded-sm bg-[var(--amber-500)]/70"
          style={{ height: `${Math.max(6, (d.count / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

/** 24 UTC buckets. The shape of someone's day locates them better than a timezone field. */
export function HoursStrip({ hours }: { hours: number[] }) {
  const max = Math.max(...hours, 1);
  if (hours.every((h) => h === 0)) return <Empty>Pas encore de rythme mesurable.</Empty>;
  return (
    <div>
      <div className="flex h-10 items-end gap-[2px]">
        {hours.map((n, h) => (
          <span
            key={h}
            title={`${String(h).padStart(2, '0')}:00 UTC — ${n}`}
            className="min-w-[3px] flex-1 rounded-sm"
            style={{
              height: `${Math.max(8, (n / max) * 100)}%`,
              backgroundColor: n > 0 ? 'var(--info)' : 'var(--ink-4)',
              opacity: n > 0 ? 0.35 + 0.65 * (n / max) : 1,
            }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-[var(--fg-5)]">
        <span>00h</span>
        <span>06h</span>
        <span>12h</span>
        <span>18h</span>
        <span>23h UTC</span>
      </div>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-[var(--ink-4)]/60 bg-[var(--ink-1)]/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--fg-5)]">{label}</div>
      <div className="font-mono text-base tabular-nums text-[var(--fg-1)]">{value}</div>
      {hint && <div className="text-[10px] text-[var(--fg-4)]">{hint}</div>}
    </div>
  );
}
