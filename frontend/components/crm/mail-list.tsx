'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  mailFilters,
  mailRows,
  searchRows,
  type MailFilterKey,
  type MailRow,
  type RowsInput,
} from '@/lib/crm/mail-rows';
import { REPLY_GROUP_LABEL } from '@/lib/crm/business';
import { flameOf } from '@/lib/crm/heat';
import { localDay } from '@/lib/crm/snooze';
import { NewInstitutionForm } from './new-institution';

/**
 * The left column. Holds no rule of its own: it asks mail-rows.ts what the
 * filters and the rows are, and draws them. That split is what makes this half
 * of the screen testable, since the vitest config covers lib/ and app/ only.
 *
 * An active filter is lighter, bolder and underlined; urgency is the accent
 * colour plus a thin rule down the left edge. Business chips are the one
 * exception to the old no-badge rule, by the owner's explicit ruling (A1).
 *
 * The accent is --amber-500 rather than --accent. The latter exists but is
 * theme-dependent, near-white under :root and amber only under .dark, so it
 * would print white-on-dark rules on a light theme. --amber-500 is the stable
 * token the rest of the CRM already reads.
 */

/** The +7 days quick-snooze target, in the operator's own calendar. */
function snoozeTarget(): string {
  return localDay(new Date(Date.now() + 7 * 86_400_000));
}

/**
 * The hover gestures: clear the day's queue without opening anything. Snooze
 * and archive need a prospect row to write on, so a client with no sourcing
 * only offers "lu". Every action refreshes the server payload afterwards —
 * the row's disappearance from the filter IS the confirmation.
 */
export async function rowAction(
  row: MailRow,
  kind: 'snooze' | 'archive' | 'read',
): Promise<boolean> {
  async function post(url: string, body: unknown): Promise<boolean> {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return r.ok;
    } catch {
      return false;
    }
  }
  if (kind === 'snooze' && row.prospectId) {
    return post('/api/crm/prospect-status', { id: row.prospectId, wakeUpAt: snoozeTarget() });
  }
  if (kind === 'archive' && row.prospectId) {
    return post('/api/crm/prospect-status', { id: row.prospectId, status: 'archive' });
  }
  if (kind === 'read' && row.email) {
    return post('/api/crm/thread-read', { email: row.email });
  }
  return false;
}

function RowActions({
  row,
  onDone,
  onBusy,
}: {
  row: MailRow;
  onDone: () => void;
  onBusy: (b: boolean) => void;
}) {
  async function post(url: string, body: unknown): Promise<boolean> {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  async function act(kind: 'snooze' | 'archive' | 'read', e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (kind === 'archive' && !window.confirm(`Archiver ${row.who} ? (statut terminal côté prospection)`)) return;
    onBusy(true);
    let ok = false;
    if (kind === 'snooze' && row.prospectId) {
      ok = await post('/api/crm/prospect-status', { id: row.prospectId, wakeUpAt: snoozeTarget() });
    } else if (kind === 'archive' && row.prospectId) {
      ok = await post('/api/crm/prospect-status', { id: row.prospectId, status: 'archive' });
    } else if (kind === 'read' && row.email) {
      ok = await post('/api/crm/thread-read', { email: row.email });
    }
    onBusy(false);
    if (ok) onDone();
  }

  const btn =
    'rounded border border-[var(--ink-5)] bg-[var(--ink-1)]/95 px-1.5 py-0.5 text-[11px] text-[var(--fg-2)] hover:border-[var(--amber-500)]/60 hover:text-[var(--fg-1)]';

  return (
    <span className="absolute bottom-2.5 right-2 hidden gap-1 group-hover:flex">
      {row.prospectId && (
        <button type="button" className={btn} title="Mettre en veille 7 jours" onClick={(e) => act('snooze', e)}>
          💤 7 j
        </button>
      )}
      {row.prospectId && (
        <button type="button" className={btn} title="Archiver (terminal)" onClick={(e) => act('archive', e)}>
          📥
        </button>
      )}
      {row.unread && (
        <button type="button" className={btn} title="Marquer lu sans ouvrir" onClick={(e) => act('read', e)}>
          ✓ lu
        </button>
      )}
    </span>
  );
}

const CONFIDENCE_BADGE: Record<string, { label: string; cls: string }> = {
  high: { label: 'haute', cls: 'text-[var(--ok,#22c55e)]' },
  medium: { label: 'moy.', cls: 'text-[var(--amber-500)]' },
  low: { label: 'faible', cls: 'text-[var(--err,#ef4444)]' },
};

export function MailList({
  input,
  selectedId,
  onSelect,
  initialFilter,
}: {
  input: RowsInput;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Deep-linked landing filter (e.g. the Prospects nav entry). */
  initialFilter?: MailFilterKey;
}) {
  const router = useRouter();
  // 'reply' rather than 'all': the column opens on what the day owes. Local
  // state, because nothing outside this column needs to know which filter is on.
  const [active, setActive] = useState<MailFilterKey>(initialFilter ?? 'reply');
  // The query narrows the rows below and never the counted filters: those read
  // the unnarrowed input, so the counts hold still while the operator types.
  // Both rules live in searchRows; this component only holds the input's state.
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const filters = mailFilters(input);
  const rows = searchRows(mailRows(input, active), q);

  // Touch swipe: left = snooze (needs a prospect row), right = mark read
  // (needs an unread thread). 64px of travel commits; less snaps back. Held
  // as (id, dx) so only the touched row translates.
  const touch = useRef<{ id: string; x: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number } | null>(null);

  function onTouchStart(id: string, e: React.TouchEvent) {
    touch.current = { id, x: e.touches[0].clientX };
  }
  function onTouchMove(e: React.TouchEvent) {
    if (!touch.current) return;
    const dx = e.touches[0].clientX - touch.current.x;
    if (Math.abs(dx) > 8) setDrag({ id: touch.current.id, dx: Math.max(-96, Math.min(96, dx)) });
  }
  async function onTouchEnd() {
    const d = drag;
    touch.current = null;
    setDrag(null);
    if (!d || Math.abs(d.dx) < 64) return;
    const row = rows.find((r) => r.id === d.id);
    if (!row) return;
    const kind = d.dx < 0 ? 'snooze' : 'read';
    if (kind === 'snooze' && !row.prospectId) return;
    if (kind === 'read' && !row.unread) return;
    setBusy(true);
    const ok = await rowAction(row, kind);
    setBusy(false);
    if (ok) router.refresh();
  }

  return (
    <div className="flex min-w-0 flex-col border-r border-[var(--ink-4)]/60 bg-[var(--ink-2)]/40">
      <div className="border-b border-[var(--ink-4)]/60 focus-within:border-[var(--amber-500)]/50">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher (nom, adresse, contenu)…"
          aria-label="Rechercher un contact"
          className="w-full min-w-0 bg-transparent px-4 py-2 text-base text-[var(--fg-1)] placeholder:text-[var(--fg-3)] focus:outline-none sm:text-[13.5px]"
        />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0 border-b border-[var(--ink-4)]/60 px-4 pt-3">
        {filters.map((f) => {
          const on = f.key === active;
          const accent = f.key === 'reply';
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setActive(f.key)}
              aria-pressed={on}
              className={[
                'border-b-2 pb-[9px] text-[13.5px] whitespace-nowrap',
                on ? 'font-semibold' : '',
                accent
                  ? 'text-[var(--amber-500)]'
                  : on
                    ? 'text-[var(--fg-1)]'
                    : 'text-[var(--fg-3)]',
                on
                  ? accent
                    ? 'border-b-[var(--amber-500)]'
                    : 'border-b-[var(--fg-3)]'
                  : 'border-transparent',
              ].join(' ')}
            >
              {f.label} <span className="ml-1 tabular-nums opacity-75">{f.count}</span>
            </button>
          );
        })}
      </div>

      {/* Only under Correspondances. Registering an address is the gesture that
          filter is FOR — nothing else on this page can make an institution's
          thread appear — and it would be noise above the day's reply queue. */}
      {active === 'institution' && <NewInstitutionForm />}

      <div className={`min-h-0 flex-1 overflow-y-auto py-1.5 ${busy ? 'opacity-60' : ''}`}>
        {rows.length === 0 ? (
          // Two different absences: a filter can be empty, and a search can
          // empty a filter that is not. Blaming the filter while a query
          // stands would send the operator to the wrong control.
          <p className="px-4 py-6 text-center text-[13.5px] text-[var(--fg-3)]">
            {q.trim()
              ? 'Aucun contact ne correspond.'
              : active === 'institution'
                ? // Naming the way out rather than the emptiness: this filter is
                  // empty until an address is registered, and the control that
                  // registers one is directly above this line.
                  'Aucun correspondant enregistré. Ajoute une adresse pour que son fil remonte ici.'
                : 'Rien dans ce filtre.'}
          </p>
        ) : (
          rows.map((r, i) => {
            const on = r.id === selectedId;
            // A shelf label above the first row of each group. The rows arrive
            // already ordered urgent → week → later (see mail-rows), so this
            // only ever cuts the sequence.
            const shelf = r.group && r.group !== rows[i - 1]?.group ? REPLY_GROUP_LABEL[r.group] : null;
            const flame = flameOf(r.heat);
            return (
              <div key={r.id} className="group relative">
                {shelf && (
                  <p className="border-b border-[var(--ink-4)]/40 bg-white/[0.02] px-3.5 py-1 text-[10.5px] font-medium uppercase tracking-[0.12em] text-[var(--fg-3)]">
                    {shelf}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => onSelect(r.id)}
                  onTouchStart={(e) => onTouchStart(r.id, e)}
                  onTouchMove={onTouchMove}
                  onTouchEnd={onTouchEnd}
                  style={drag?.id === r.id ? { transform: `translateX(${drag.dx}px)`, transition: 'none' } : undefined}
                  aria-pressed={on}
                  className={[
                    'block w-full border-l-2 px-3.5 py-2.5 text-left',
                    on ? 'bg-white/5' : '',
                    r.urgent
                      ? on
                        ? 'border-l-[var(--amber-500)]'
                        : 'border-l-[var(--amber-500)]/45'
                      : on
                        ? 'border-l-[var(--fg-3)]'
                        : 'border-transparent',
                  ].join(' ')}
                >
                  <span className="flex items-baseline justify-between gap-2.5">
                    {/* The return of a sleeper: its wake date arrived. Ahead of
                        the business chip because the date is why the row is
                        here today, whatever else the row is. */}
                    {r.woke && (
                      <span
                        title="Sa date de réveil est arrivée"
                        className="shrink-0 self-center rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-300"
                      >
                        ⏰ réveillé
                      </span>
                    )}
                    {r.chip && (
                      <span
                        className="shrink-0 self-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                        style={{ color: r.chip.color, backgroundColor: r.chip.bg }}
                      >
                        {r.chip.label}
                      </span>
                    )}
                    {/* min-w-0 as well as truncate: a flex child will not shrink
                        below its content without it, and `who` falls back to the
                        email address, which is one unbreakable token. */}
                    <span
                      title={r.who}
                      className={`min-w-0 truncate text-sm text-[var(--fg-1)] ${
                        r.unread || on ? 'font-semibold' : ''
                      }`}
                    >
                      {r.who}
                    </span>
                    {/* Unread is said by weight; the words live here for a
                        screen reader, invisible on screen. */}
                    {r.unread && <span className="sr-only">Réponse non lue</span>}
                    {flame && (
                      <span
                        className={`shrink-0 text-[11px] ${flame.dim ? 'opacity-45' : ''}`}
                        title={`Chaleur ${r.heat}/100 — détail dans le dossier`}
                      >
                        {flame.glyph}
                      </span>
                    )}
                    {active === 'prospect' && r.confidence ? (
                      <span className={`shrink-0 text-[12px] group-hover:invisible ${CONFIDENCE_BADGE[r.confidence].cls}`}>
                        {CONFIDENCE_BADGE[r.confidence].label}
                      </span>
                    ) : (
                      <span
                        className={`shrink-0 text-[13.5px] tabular-nums group-hover:invisible ${
                          r.urgent ? 'text-[var(--amber-500)]' : 'text-[var(--fg-3)]'
                        }`}
                      >
                        {r.age}
                      </span>
                    )}
                  </span>
                  <span
                    className={`mt-0.5 block truncate text-[13px] ${
                      r.unread ? 'font-medium text-[var(--fg-1)]' : 'text-[var(--fg-2)]'
                    }`}
                  >
                    {r.subject}
                  </span>
                  <span className="mt-px block truncate text-[13.5px] text-[var(--fg-3)]">
                    {r.preview}
                  </span>
                </button>
                <RowActions row={r} onBusy={setBusy} onDone={() => router.refresh()} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
