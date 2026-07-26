import { formatDay } from '@/lib/crm/format';
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
/**
 * These labels name who owes the next move, never what to do about it. The
 * 'them' label in particular is not NEXT_ACTION_LABEL.wait: both used to read
 * "en attente de sa réponse", so the commonest state of all, just after a first
 * mail goes out, spent two of the band's three slots saying one thing. Stated
 * here rather than in situation.ts because that map is shared with callers that
 * want the action phrasing.
 */
const BALL = {
  us: { label: '⚠ À TOI DE JOUER', fg: '#fca5a5', bg: '#7f1d1d33', border: '#7f1d1d' },
  them: { label: 'LA BALLE EST CHEZ LUI', fg: '#93c5fd', bg: '#1e3a5f33', border: '#1e3a5f' },
  none: { label: 'Jamais contacté', fg: '#a1a1aa', bg: '#27272a', border: '#3f3f46' },
} as const;

export function SituationBand({ situation: s }: { situation: Situation }) {
  const b = BALL[s.ballInCourt];
  // A message sent today is not a silence, and "silence depuis 0 j" reads as a
  // bug. The thread below already carries the date of the last message.
  const silence = s.silenceDays !== null && s.silenceDays > 0 ? s.silenceDays : null;
  const firstContact = formatDay(s.firstContactAt);
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
          {silence !== null && (
            <span className="text-xs text-[var(--fg-2)]">
              silence depuis <strong>{silence} j</strong>
            </span>
          )}
        </div>
        {/* --fg-3, not --fg-4: measured on composited pixels, --fg-4 at 10px
            clears AA on the two dark tints (4.69:1, 4.68:1) but drops to
            3.92:1 on the lighter 'none' band, so the same line passed or
            failed depending on the ball state. --fg-3 clears all three. */}
        <span className="text-[10px] text-[var(--fg-3)]">
          {firstContact ? `1er contact ${firstContact} · ` : ''}
          {s.messageCount} message{s.messageCount > 1 ? 's' : ''}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] text-amber-300">→ {NEXT_ACTION_LABEL[s.nextAction]}</p>
    </div>
  );
}
