'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * The one gesture on a feedback report: it has been read and handled.
 *
 * Client island inside a server-rendered card, like the CRM's controls: the
 * card lists, this button writes. Reads the answer, not the status code —
 * `{ updated: 0 }` comes back 200 for a stale id, and a silent refresh would
 * leave the operator believing a report was closed when it was not.
 */
export function FeedbackDoneButton({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function done() {
    setBusy(true);
    setFailed(false);
    try {
      const r = await fetch('/api/crm/feedback-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'done' }),
      });
      const body = (await r.json().catch(() => null)) as { updated?: number } | null;
      if (!r.ok || body?.updated !== 1) {
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

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void done()}
      className="cursor-pointer whitespace-nowrap rounded border border-[var(--ink-4)] px-1.5 py-0.5 text-[11px] text-[var(--fg-3)] hover:text-[var(--fg-1)] disabled:cursor-default disabled:opacity-50"
    >
      {failed ? 'échec — réessayer' : 'traité'}
    </button>
  );
}
