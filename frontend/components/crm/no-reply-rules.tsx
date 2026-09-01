'use client';

import { useCallback, useState } from 'react';

/**
 * The standing « rien à répondre » rules, finally listable after the fact.
 *
 * The gap this closes was flagged the day the feature shipped: a rule is
 * offered in the breath after marking a message, and its undo lived only in
 * that same breath — session state. Come back two days later and the UI could
 * neither show that a rule existed nor take one back; the address kept
 * arriving pre-marked with nothing anywhere saying why. For a gesture whose
 * failure mode is "an authority's future mail is buried in silence", an
 * invisible rule set is the exact opposite of what the operator needs.
 *
 * Folded shut by default and loaded only on opening: rules are rare (robots
 * by shape only — the API refuses anything else with a 422), and the Contacts
 * page has no business paying a fetch for a drawer nobody opens most days.
 *
 * Removal deliberately leaves already-marked messages alone; the backend
 * states that contract and this UI repeats it where the finger hovers.
 */

interface RuleRow {
  address: string;
  created_at: string;
}

export function NoReplyRules() {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<RuleRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const r = await fetch('/api/crm/no-reply-sender');
      const body = (await r.json().catch(() => null)) as { senders?: RuleRow[] } | null;
      if (!r.ok || !body?.senders) {
        setFailed('liste indisponible');
        return;
      }
      setRules(body.senders);
    } catch {
      setFailed('liste indisponible');
    }
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && rules === null) void load();
  }

  async function remove(address: string) {
    setBusy(address);
    setFailed(null);
    try {
      const r = await fetch('/api/crm/no-reply-sender', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, value: false }),
      });
      if (!r.ok) {
        setFailed('le retrait n’a pas été enregistré');
        return;
      }
      // Re-read rather than splice: the list is tiny and the server is the
      // only truth worth showing after a write.
      await load();
    } catch {
      setFailed('le retrait n’a pas été enregistré');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 text-[12px] text-[var(--fg-3)]">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-[var(--fg-1)]"
      >
        {open ? '▾' : '▸'} Règles « rien à répondre » par expéditeur
      </button>

      {open && (
        <div className="mt-2 rounded-lg border border-[var(--ink-4)]/60 bg-[var(--ink-1)]/40 p-3">
          {rules === null && !failed && <p>chargement…</p>}
          {failed && (
            <p role="alert" className="text-red-400">
              {failed}
            </p>
          )}
          {rules !== null && rules.length === 0 && (
            <p>
              Aucune règle. Elles se posent depuis la fiche d’un contact, dans la seconde qui suit un
              « Rien à répondre » sur un message de robot.
            </p>
          )}
          {rules !== null && rules.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {rules.map((r) => (
                <li key={r.address} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="wrap-anywhere font-medium text-[var(--fg-2)]">{r.address}</span>
                  <span className="text-[var(--fg-4)]">depuis le {r.created_at.slice(0, 10)}</span>
                  <button
                    type="button"
                    disabled={busy === r.address}
                    onClick={() => void remove(r.address)}
                    title="Les prochains messages de cette adresse ne seront plus marqués d’office. Les messages déjà marqués ne changent pas."
                    className="cursor-pointer underline underline-offset-2 hover:text-[var(--fg-1)] disabled:cursor-default disabled:opacity-50"
                  >
                    retirer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
