'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Data that states its age. Both CRM pages are server-fetched then live for a
 * whole working session; reading an hour-old state without knowing it is how
 * wrong decisions happen. No auto-refresh ever: the page must not move under
 * the operator's fingers — the button is a deliberate gesture
 * (router.refresh() re-runs the server fetch in place).
 */
export function FreshnessBadge({ fetchedAtIso }: { fetchedAtIso: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [ageMin, setAgeMin] = useState(0);

  useEffect(() => {
    const tick = () => setAgeMin(Math.floor((Date.now() - Date.parse(fetchedAtIso)) / 60_000));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [fetchedAtIso]);

  // Formatted in a FIXED zone, so the server (UTC on Vercel) and the browser
  // (Zurich) print the same text for the same instant. getHours() printed the
  // runtime's local hour on each side: « 08:35 » in the HTML, « 10:35 » after
  // hydration, and React 19 reported the mismatch (#418) on every page that
  // carries this badge — which is every dashboard page.
  const hhmm = new Intl.DateTimeFormat('fr-CH', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Zurich',
  }).format(new Date(fetchedAtIso));
  const stale = ageMin >= 15;

  return (
    <span className="inline-flex items-center gap-1.5 text-[12px]">
      {/* --fg-3, not --fg-5: this is the one line that says the data is
          forty minutes old, and at --fg-5 it measured 2.6:1 on the ground. */}
      <span className={stale ? 'text-amber-400' : 'text-[var(--fg-3)]'}>
        données de {hhmm}
        {stale ? ` (il y a ${ageMin} min)` : ''}
      </span>
      <button
        type="button"
        onClick={() => {
          setBusy(true);
          router.refresh();
          setTimeout(() => setBusy(false), 1500);
        }}
        disabled={busy}
        title="Recharger les données (jamais automatique)"
        className={`rounded border px-1.5 py-0.5 transition-colors ${
          stale
            ? 'border-amber-500/40 text-amber-400 hover:bg-amber-500/10'
            : 'border-[var(--ink-4)] text-[var(--fg-4)] hover:text-[var(--fg-2)]'
        } disabled:opacity-40`}
      >
        {busy ? '…' : '↻'}
      </button>
    </span>
  );
}
