'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { localDay } from '@/lib/crm/snooze';
import type { Outcome, ProspectSourcing } from '@/lib/crm/types';

/**
 * Where the relationship stands, in the operator's own words.
 *
 * The gap this fills, from the 27/07/2026 audit: nothing in the CRM could
 * record an outcome. Not "they already have a supplier", not "call me back in
 * September", not "wrong person, aim at the CTO". The only gestures were
 * archive and reject, which erase a row rather than qualify it, so everything
 * learned in a conversation died with the conversation and the next campaign
 * started blind.
 *
 * Kept to four values on purpose. A longer list is a list nobody fills in
 * honestly, and the free-text note carries what the buttons cannot: the reason
 * a deal dies is never one of five buttons, and a wrong button teaches the
 * next campaign the wrong lesson.
 *
 * Separate from ProspectStatusControl, which sits beside it, because the two
 * answer different questions. That one says where the sourcing got to; this
 * one says where the relationship got to. Sending one never touches the other,
 * on the wire or in the table.
 */
const OUTCOMES: Array<{ key: Outcome; label: string; color: string; needsDate?: boolean }> = [
  { key: 'en_discussion', label: 'En discussion', color: '#34d399' },
  { key: 'pas_maintenant', label: 'Pas maintenant', color: '#fbbf24', needsDate: true },
  { key: 'pas_interesse', label: 'Pas intéressé', color: '#f87171' },
  { key: 'mauvaise_personne', label: 'Mauvaise personne', color: '#a1a1aa' },
];

const BY_KEY = new Map(OUTCOMES.map((o) => [o.key, o]));

export function OutcomeBadge({ sourcing }: { sourcing: ProspectSourcing }) {
  const o = sourcing.outcome ? BY_KEY.get(sourcing.outcome) : undefined;
  if (!o) return null;
  const until = sourcing.wakeUpAt ? ` jusqu'au ${sourcing.wakeUpAt}` : '';
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ color: o.color, backgroundColor: `${o.color}22` }}
      title={sourcing.outcomeNote ?? undefined}
    >
      {o.label}
      {until}
    </span>
  );
}

export function OutcomeControl({ sourcing }: { sourcing: ProspectSourcing }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<Outcome | null>(null);
  const [note, setNote] = useState('');
  const [wakeUpAt, setWakeUpAt] = useState('');

  const current = sourcing.outcome;

  async function send(outcome: Outcome | null, extra: { outcomeNote?: string; wakeUpAt?: string } = {}) {
    setBusy(true);
    setFailed(false);
    try {
      const r = await fetch('/api/crm/prospect-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sourcing.prospectId, outcome, ...extra }),
      });
      // Same reasoning as the status control beside it: 200 is not proof of a
      // change. The endpoint answers { updated: changes }, so an id matching no
      // row comes back 200 with 0, and a silent refresh would leave the
      // operator believing an outcome was recorded when none was.
      const body: unknown = await r.json().catch(() => null);
      const updated =
        body && typeof body === 'object' && 'updated' in body ? (body as { updated: unknown }).updated : undefined;
      if (!r.ok || updated === 0) {
        setFailed(true);
        return;
      }
      setPending(null);
      setNote('');
      setWakeUpAt('');
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  function choose(key: Outcome) {
    // Clicking the outcome already recorded takes it back, which is how a
    // judgement entered by mistake is undone without a second control.
    if (current === key) {
      void send(null);
      return;
    }
    setPending(key);
    setNote('');
    // A sensible default the operator can overwrite: most "call me back" lands
    // a month or two out, and an empty required field is a dead end.
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    setWakeUpAt(localDay(d));
  }

  const chosen = pending ? BY_KEY.get(pending) : undefined;
  // The one field the API refuses to do without, so the button says so rather
  // than letting the request come back 400.
  const dateMissing = !!chosen?.needsDate && !/^\d{4}-\d{2}-\d{2}$/.test(wakeUpAt);

  return (
    <div className="mt-3 border-t border-[var(--ink-4)]/60 pt-3 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[var(--fg-3)]">Où ça en est :</span>
        {OUTCOMES.map((o) => {
          const active = current === o.key;
          return (
            <button
              key={o.key}
              type="button"
              disabled={busy}
              aria-pressed={active}
              onClick={() => choose(o.key)}
              title={active ? 'Cliquer à nouveau pour retirer ce classement' : undefined}
              className="cursor-pointer rounded-full px-2 py-0.5 font-medium transition-colors disabled:cursor-default disabled:opacity-50"
              style={
                active
                  ? { color: o.color, backgroundColor: `${o.color}22` }
                  : { color: 'var(--fg-3)', backgroundColor: 'var(--ink-4)' }
              }
            >
              {o.label}
            </button>
          );
        })}
      </div>

      {current && sourcing.outcomeNote && !pending && (
        <p className="mt-2 wrap-anywhere text-[var(--fg-2)]">
          <span className="text-[var(--fg-3)]">Note : </span>
          {sourcing.outcomeNote}
        </p>
      )}

      {chosen && (
        <div className="mt-2 space-y-2 rounded-lg border border-[var(--ink-4)] bg-[var(--ink-1)] p-2">
          {chosen.needsDate && (
            <label className="flex items-center gap-2 text-[var(--fg-2)]">
              Recontacter le
              <input
                type="date"
                value={wakeUpAt}
                onChange={(e) => setWakeUpAt(e.target.value)}
                className="rounded border border-[var(--ink-4)] bg-[var(--ink-0)] px-2 py-1 text-[var(--fg-1)]"
              />
            </label>
          )}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Pourquoi, en une phrase (facultatif)"
            aria-label="Note sur le classement"
            className="w-full min-w-0 rounded border border-[var(--ink-4)] bg-[var(--ink-0)] px-2 py-1 text-[var(--fg-1)] placeholder:text-[var(--fg-4)]"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy || dateMissing}
              onClick={() =>
                void send(chosen.key, {
                  ...(note.trim() ? { outcomeNote: note.trim() } : {}),
                  ...(chosen.needsDate ? { wakeUpAt } : {}),
                })
              }
              className="cursor-pointer rounded bg-amber-500/20 px-2 py-1 font-medium text-amber-300 disabled:cursor-default disabled:opacity-50"
            >
              Enregistrer
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPending(null)}
              className="cursor-pointer text-[var(--fg-3)] underline underline-offset-2 hover:text-[var(--fg-1)]"
            >
              annuler
            </button>
            {dateMissing && <span className="text-[var(--fg-3)]">une date est nécessaire</span>}
          </div>
        </div>
      )}

      {/* alert, not status: raised by something the operator just did. */}
      {failed && (
        <p role="alert" className="mt-2 text-red-400">
          échec, rien n’a été enregistré
        </p>
      )}
    </div>
  );
}
