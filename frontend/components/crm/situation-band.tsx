import { NEXT_ACTION_LABEL } from '@/lib/crm/situation';
import type { Situation } from '@/lib/crm/types';

/**
 * The band answers, in one glance, the three questions asked on opening a
 * contact: who holds the ball, for how long, and what to do next. The whole
 * surface is tinted by the ball state so the answer to the first one lands
 * before any text is read.
 *
 * No state and no event handler here, so this stays a Server Component: it
 * ships no JavaScript to the browser.
 */
const BALL = {
  us: { label: '⚠ À TOI DE JOUER', fg: '#fca5a5', bg: '#7f1d1d33', border: '#7f1d1d' },
  them: { label: 'En attente de sa réponse', fg: '#93c5fd', bg: '#1e3a5f33', border: '#1e3a5f' },
  none: { label: 'Jamais contacté', fg: '#a1a1aa', bg: '#27272a', border: '#3f3f46' },
} as const;

export function SituationBand({ situation: s }: { situation: Situation }) {
  const b = BALL[s.ballInCourt];
  return (
    <div
      className="rounded-lg border px-3 py-2"
      style={{ backgroundColor: b.bg, borderColor: b.border }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: b.fg }}>
            {b.label}
          </span>
          {s.silenceDays !== null && (
            <span className="text-xs text-[var(--fg-2)]">
              silence depuis <strong>{s.silenceDays} j</strong>
            </span>
          )}
        </div>
        <span className="text-[10px] text-[var(--fg-4)]">
          {s.firstContactAt ? `1er contact ${s.firstContactAt.slice(0, 10)} · ` : ''}
          {s.messageCount} message{s.messageCount > 1 ? 's' : ''}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] text-amber-300">→ {NEXT_ACTION_LABEL[s.nextAction]}</p>
    </div>
  );
}
