/**
 * "Le point de la semaine" — the Monday auto-written digest, top of the
 * dashboard. The newest digest renders as prose; previous weeks fold into a
 * native <details>. Hidden entirely while no digest exists (the card must
 * never show placeholder prose — an empty analysis reads as a broken one).
 */
export interface DigestEntry {
  week: string;
  created_at: string;
  body_fr: string;
}

function weekTitle(week: string): string {
  const m = week.match(/^(\d{4})-W(\d{2})$/);
  return m ? `Semaine ${m[2]} · ${m[1]}` : week;
}

export function WeeklyDigestCard({ digests }: { digests: DigestEntry[] }) {
  if (digests.length === 0) return null;
  const [latest, ...older] = digests;

  return (
    <div className="rounded-xl border border-sky-500/25 bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-[var(--fg-1)]">
          <span aria-hidden>🗞</span> Le point de la semaine — {weekTitle(latest.week)}
        </p>
        <p className="text-[11px] text-[var(--fg-5)]">rédigé automatiquement le lundi matin, aussi sur Telegram</p>
      </div>
      <div className="whitespace-pre-line text-sm leading-relaxed text-[var(--fg-2)]">{latest.body_fr}</div>

      {older.length > 0 && (
        <details className="mt-4 border-t border-[var(--ink-4)]/60 pt-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--fg-4)] hover:text-[var(--fg-2)]">
            Semaines précédentes ({older.length})
          </summary>
          <div className="mt-3 space-y-4">
            {older.map((d) => (
              <div key={d.week}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--fg-4)]">
                  {weekTitle(d.week)}
                </p>
                <div className="whitespace-pre-line text-[13px] leading-relaxed text-[var(--fg-3)]">{d.body_fr}</div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
