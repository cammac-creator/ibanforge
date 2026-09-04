'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OrphanMailRow } from './orphan-mail-panel';

/**
 * « Qu'est-ce que j'ai classé hier ? » — the rows already dealt with.
 *
 * Every exit from the orphan queue used to be final and invisible: dismissed
 * rows left the panel, the panel itself vanished when the queue was empty, and
 * nothing anywhere listed what had been decided. A mail filed by mistake was
 * gone without a trace. This drawer reads the resolved rows on demand and
 * offers each one the way back — the API's /reopen — after which the row is
 * waiting again and the page is refreshed so the panel above shows it.
 *
 * Folded and fetched only on opening, like the rule drawers of the Contacts
 * page: most days nobody needs it, and the overview must not pay a fetch for
 * a drawer nobody opens.
 */
export function ResolvedOrphans({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<OrphanMailRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const r = await fetch('/api/crm/orphan-mail?all=1&limit=200');
      const body = (await r.json().catch(() => null)) as { orphans?: OrphanMailRow[] } | null;
      if (!r.ok || !body?.orphans) {
        setFailed('liste indisponible');
        return;
      }
      // Newest decision first: the one to take back is almost always the last one made.
      setRows(
        body.orphans
          .filter((o) => o.resolved)
          .sort((a, b) => b.msg_date.localeCompare(a.msg_date))
          .slice(0, 40),
      );
    } catch {
      setFailed('liste indisponible');
    }
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && rows === null) void load();
  }

  async function reopen(id: string) {
    setBusy(id);
    setFailed(null);
    try {
      const r = await fetch('/api/crm/orphan-resolve', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) {
        setFailed('la remise en file n’a pas été enregistrée');
        return;
      }
      await load();
      router.refresh();
    } catch {
      setFailed('la remise en file n’a pas été enregistrée');
    } finally {
      setBusy(null);
    }
  }

  const outcome = (o: OrphanMailRow): string => {
    if (!o.resolved_as) return 'classé sans rattachement';
    if (o.resolved_as.toLowerCase() === o.sender.toLowerCase())
      return 'enregistré comme correspondant';
    return `rattaché à ${o.resolved_as}`;
  };

  return (
    <div
      className={compact ? 'text-[12px] text-[var(--fg-4)]' : 'mt-3 text-[12px] text-[var(--fg-3)]'}
    >
      {compact && <span>Courrier à rattacher : rien en attente · </span>}
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-[var(--fg-1)]"
      >
        {open ? '▾' : '▸'} classés récemment
      </button>

      {open && (
        <div className="mt-2 rounded-lg border border-[var(--ink-4)]/60 bg-[var(--ink-1)]/40 p-3 text-[var(--fg-3)]">
          {rows === null && !failed && <p>chargement…</p>}
          {failed && (
            <p role="alert" className="text-red-400">
              {failed}
            </p>
          )}
          {rows !== null && rows.length === 0 && <p>Rien de classé pour l’instant.</p>}
          {rows !== null && rows.length > 0 && (
            <ul className="flex flex-col gap-2">
              {rows.map((o) => (
                <li key={o.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="shrink-0 tabular-nums text-[var(--fg-4)]">
                    {o.msg_date.slice(0, 10)}
                  </span>
                  <span className="wrap-anywhere font-medium text-[var(--fg-2)]">{o.sender}</span>
                  {o.subject && (
                    <span className="wrap-anywhere text-[var(--fg-3)]">« {o.subject} »</span>
                  )}
                  <span className="text-[var(--fg-4)]">{outcome(o)}</span>
                  <button
                    type="button"
                    disabled={busy === o.id}
                    onClick={() => void reopen(o.id)}
                    title="Le mail revient dans la file, sans client nommé. Un alias posé en le rattachant reste : retire-le depuis « Alias enregistrés » si c’était l’erreur."
                    className="cursor-pointer underline underline-offset-2 hover:text-[var(--fg-1)] disabled:cursor-default disabled:opacity-50"
                  >
                    {busy === o.id ? 'un instant…' : 'remettre en file'}
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
