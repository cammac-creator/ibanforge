'use client';

import { useCallback, useState } from 'react';
import { invalidateAliases } from '@/lib/crm/people-index';

/**
 * The standing aliases — « cette adresse EST ce client » — listable and
 * removable after the fact.
 *
 * Modelled on the « rien à répondre » rules beside it, for the same reason:
 * an alias is offered in the breath after a « Rattacher », and until now its
 * undo did not exist anywhere. Two aliases accepted from a pre-selected
 * proposal on 2026-09-03 then pulled months of a directory's build notices
 * into a prospect's thread at the next sync, and the only way back was a
 * script. This drawer is the way back.
 *
 * One difference the sentence under the finger has to carry: removing a
 * « rien à répondre » rule touches no data, while removing an alias MOVES
 * rows — the inbound messages that came from the alias address go back to
 * that address's own thread, and the API answers with how many. That number
 * is shown, because "retiré" alone would under-describe what just happened,
 * the same way the attach confirmation used to.
 */

interface AliasRow {
  alias: string;
  canonical: string;
  created_at: string;
}

export function AliasRules() {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<AliasRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const r = await fetch('/api/crm/email-aliases');
      const body = (await r.json().catch(() => null)) as { aliases?: AliasRow[] } | null;
      if (!r.ok || !body?.aliases) {
        setFailed('liste indisponible');
        return;
      }
      setRules(body.aliases);
    } catch {
      setFailed('liste indisponible');
    }
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && rules === null) void load();
  }

  async function remove(alias: string) {
    setBusy(alias);
    setFailed(null);
    setLast(null);
    try {
      const r = await fetch('/api/crm/email-aliases', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias }),
      });
      const body = (await r.json().catch(() => null)) as { refiled?: number } | null;
      if (!r.ok) {
        setFailed('le retrait n’a pas été enregistré');
        return;
      }
      invalidateAliases();
      const n = body?.refiled ?? 0;
      setLast(
        n === 0
          ? `✓ alias retiré — aucun message n’était rangé sous l’autre dossier`
          : `✓ alias retiré — ${n} message${n > 1 ? 's' : ''} rendu${n > 1 ? 's' : ''} au fil de ${alias}`,
      );
      await load();
    } catch {
      setFailed('le retrait n’a pas été enregistré');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-2 text-[12px] text-[var(--fg-3)]">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-[var(--fg-1)]"
      >
        {open ? '▾' : '▸'} Alias enregistrés (« cette adresse est ce client »)
      </button>

      {open && (
        <div className="mt-2 rounded-lg border border-[var(--ink-4)]/60 bg-[var(--ink-1)]/40 p-3">
          {rules === null && !failed && <p>chargement…</p>}
          {failed && (
            <p role="alert" className="text-red-400">
              {failed}
            </p>
          )}
          {last && (
            <p role="status" className="mb-2 text-emerald-400">
              {last}
            </p>
          )}
          {rules !== null && rules.length === 0 && (
            <p>
              Aucun alias. Ils se posent depuis la file « Courrier à rattacher » de la Vue
              d’ensemble, en rattachant un expéditeur inconnu à un client.
            </p>
          )}
          {rules !== null && rules.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {rules.map((r) => (
                <li key={r.alias} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="wrap-anywhere font-medium text-[var(--fg-2)]">{r.alias}</span>
                  <span className="text-[var(--fg-4)]">→</span>
                  <span className="wrap-anywhere text-[var(--fg-2)]">{r.canonical}</span>
                  <span className="text-[var(--fg-4)]">depuis le {r.created_at.slice(0, 10)}</span>
                  <button
                    type="button"
                    disabled={busy === r.alias}
                    onClick={() => void remove(r.alias)}
                    title="Les messages reçus de cette adresse reviennent dans son propre fil ; ceux qu’on a envoyés au client restent chez lui. La prochaine synchro cesse de fusionner les deux."
                    className="cursor-pointer underline underline-offset-2 hover:text-[var(--fg-1)] disabled:cursor-default disabled:opacity-50"
                  >
                    {busy === r.alias ? 'retrait…' : 'retirer'}
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
