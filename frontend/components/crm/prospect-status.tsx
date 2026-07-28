'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * The stored status of a prospect, and the three moves that change it.
 *
 * This is the only way to take a bad prospect out of the CRM: build-contacts
 * drops rows whose status is 'rejete', and nothing else removes one. Archiving
 * is the softer move, and the list's Archivés filter is where those rows go.
 *
 * Its own file rather than a block inside contact-header.tsx: this is the only
 * part of the header that needs a router and local state, so keeping the
 * directive here leaves the header renderable on the server later.
 *
 * Deliberately shows the STORED status only. Where a thread stands (contacté,
 * a répondu, relance due) is derived from the correspondence and is already
 * said, once, by the situation band directly below. Recomputing it here would
 * both repeat the band and drag a Date.now() into a client component, which is
 * the hydration hazard the page as a whole is built to avoid.
 */
const STORED_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  a_mailer: { label: 'À mailer', color: '#22c55e', bg: '#052e16' },
  a_enrichir: { label: 'À enrichir', color: '#f59e0b', bg: '#451a03' },
  // The value the ingester writes as soon as an outbound reaches the address,
  // and by far the most common one in the table: 62 rows of 80 on 27/07/2026.
  // It was missing here, so the badge rendered null for three prospects out of
  // four, and the schema comment in src/lib/db.ts did not list it either.
  contacte: { label: 'Contacté', color: '#60a5fa', bg: '#172554' },
  archive: { label: 'Archivé', color: '#a1a1aa', bg: '#27272a' },
};

export function ProspectStatusBadge({ status }: { status: string }) {
  const s = STORED_STATUS[status];
  if (!s) return null;
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
      style={{ color: s.color, backgroundColor: s.bg }}
    >
      {s.label}
    </span>
  );
}

export function ProspectStatusControl({
  prospectId,
  status,
  hasEmail,
}: {
  prospectId: string;
  status: string;
  hasEmail: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function setStatus(next: string) {
    setBusy(true);
    setFailed(false);
    try {
      const r = await fetch('/api/crm/prospect-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: prospectId, status: next }),
      });
      // The page this replaces swallowed failures entirely. A silent no-op is
      // the wrong failure here: the operator walks away believing a prospect
      // was rejected while it is still in the list.
      //
      // HTTP 200 is not enough. The endpoint answers { updated: r.changes },
      // so an id that matches no row comes back 200 with updated 0: the
      // refresh would run, nothing would change, and nothing would be said.
      // That is precisely the case this check exists for.
      const body: unknown = await r.json().catch(() => null);
      const updated =
        body && typeof body === 'object' && 'updated' in body ? (body as { updated: unknown }).updated : undefined;
      if (!r.ok || updated === 0) {
        setFailed(true);
        return;
      }
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const action =
    'cursor-pointer text-[var(--fg-3)] underline underline-offset-2 disabled:cursor-default disabled:opacity-50';

  return (
    // first:* for the prospect whose dossier holds nothing else: this control
    // is then the first child, and its separator would rule off nothing.
    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[var(--ink-4)]/60 pt-3 text-[11px] first:mt-0 first:border-t-0 first:pt-0">
      <span className="text-[var(--fg-3)]">Classer :</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => setStatus('archive')}
        className={`${action} hover:text-[var(--fg-1)]`}
      >
        archiver
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setStatus('rejete')}
        className={`${action} hover:text-red-400`}
      >
        rejeter
      </button>
      {status !== 'a_mailer' && hasEmail && (
        <button
          type="button"
          disabled={busy}
          onClick={() => setStatus('a_mailer')}
          className={`${action} hover:text-[var(--ok)]`}
        >
          marquer à mailer
        </button>
      )}
      {/* alert, not status: this is an error raised by something the operator
          just did, so it should not wait for a pause in speech. */}
      {failed && (
        <span role="alert" className="text-red-400">
          échec, statut inchangé
        </span>
      )}
    </div>
  );
}
