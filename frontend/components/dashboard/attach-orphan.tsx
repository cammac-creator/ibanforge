'use client';

import { useState } from 'react';

/**
 * The B2 gesture: "this orphan IS that customer". Registers the sender as an
 * alias of the canonical address (resolved everywhere: write endpoints and
 * the VPS sync's known-address net), then resolves the orphan. From the next
 * sync run the sender's whole thread folds into the customer's file, forever.
 */
export function AttachOrphanControl({ orphanId, sender }: { orphanId: string; sender: string }) {
  const [open, setOpen] = useState(false);
  const [canonical, setCanonical] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  if (state === 'done') {
    return (
      <p className="mt-1 text-[12px] text-emerald-400">
        ✓ {sender} rattaché à {canonical} — son fil complet remonte au prochain passage de la synchro (horaire).
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 rounded border border-amber-500/40 px-2 py-1 text-[12px] font-medium text-amber-400 hover:bg-amber-500/10"
      >
        Rattacher à un client…
      </button>
    );
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <input
        type="email"
        value={canonical}
        onChange={(e) => setCanonical(e.target.value)}
        placeholder="adresse du client (celle de sa clé)"
        className="min-w-0 flex-1 rounded border border-[var(--ink-4)] bg-[var(--ink-0)] px-2 py-1.5 text-base text-[var(--fg-1)] placeholder:text-[var(--fg-5)] focus:border-amber-500/50 focus:outline-none sm:max-w-[280px] sm:text-[12.5px]"
      />
      <button
        type="button"
        disabled={state === 'busy' || !canonical.includes('@')}
        onClick={async () => {
          if (!window.confirm(`Déclarer que ${sender} EST ${canonical.trim().toLowerCase()} ?`)) return;
          setState('busy');
          try {
            const r1 = await fetch('/api/crm/email-aliases', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ alias: sender, canonical: canonical.trim().toLowerCase() }),
            });
            const d1 = (await r1.json()) as { message?: string };
            if (!r1.ok) throw new Error(d1.message ?? `alias HTTP ${r1.status}`);
            const r2 = await fetch('/api/crm/orphan-resolve', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: orphanId, attached_to: canonical.trim().toLowerCase() }),
            });
            if (!r2.ok) throw new Error(`resolve HTTP ${r2.status}`);
            setState('done');
          } catch (e) {
            setMessage(e instanceof Error ? e.message : 'échec');
            setState('error');
          }
        }}
        className="rounded border border-emerald-500/50 px-2.5 py-1.5 text-[12px] font-medium text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40"
      >
        {state === 'busy' ? 'Rattachement…' : 'Confirmer'}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded px-1.5 py-1 text-[12px] text-[var(--fg-4)] hover:text-[var(--fg-2)]"
      >
        annuler
      </button>
      {state === 'error' && <span className="w-full text-[12px] text-red-300">échec : {message}</span>}
    </div>
  );
}
