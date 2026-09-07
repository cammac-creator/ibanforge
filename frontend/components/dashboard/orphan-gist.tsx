'use client';

import { useEffect, useState } from 'react';

/**
 * The French reading of one orphan mail, under its subject.
 *
 * Replies ask for their gist as soon as they are on screen: a reply is somebody
 * waiting, and the operator should not have to read English to know what for.
 * First contacts wait for a click, because most of them are automated notices
 * that will be dismissed unread, and a writer call per notice would be waste.
 *
 * At most two requests in flight at a time: the queue can hold forty rows and
 * the writer is one process on one VPS.
 */
let inFlight = 0;
const waiting: Array<() => void> = [];
function acquire(): Promise<void> {
  return new Promise((resolve) => {
    if (inFlight < 2) {
      inFlight++;
      resolve();
    } else
      waiting.push(() => {
        inFlight++;
        resolve();
      });
  });
}
function release() {
  inFlight--;
  waiting.shift()?.();
}

export function OrphanGist({
  id,
  sender,
  subject,
  snippet,
  msgDate,
  initial,
  eager,
}: {
  id: string;
  sender: string;
  subject: string | null;
  snippet: string | null;
  msgDate: string;
  initial: string | null;
  eager: boolean;
}) {
  const [gist, setGist] = useState<string | null>(initial);
  const [failed, setFailed] = useState(false);
  const [wanted, setWanted] = useState(eager);
  /**
   * « In flight » is not a state of its own: a row is busy exactly while it
   * wants a gist, has none, and has not failed. Held as state, it had to be
   * written from the effect body, which buys a second render for a fact the
   * first one already knew — the pattern react-hooks/set-state-in-effect names
   * (rules turned on 2026-09-07). Derived, the marker is on screen from the
   * render that fires the request rather than the one after it.
   */
  const busy = wanted && !gist && !failed;

  useEffect(() => {
    if (gist || !wanted || failed) return;
    let alive = true;
    (async () => {
      await acquire();
      try {
        const r = await fetch('/api/crm/orphan-gist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, sender, subject, snippet, msg_date: msgDate }),
        });
        const data = (await r.json().catch(() => ({}))) as { gist_fr?: string };
        if (!alive) return;
        if (r.ok && data.gist_fr) setGist(data.gist_fr);
        else setFailed(true);
      } catch {
        if (alive) setFailed(true);
      } finally {
        release();
      }
    })();
    return () => {
      alive = false;
    };
  }, [gist, wanted, failed, id, sender, subject, snippet, msgDate]);

  if (gist) {
    return (
      <div className="mt-1">
        <p className="text-[13px] leading-relaxed text-[var(--fg-2)]">{gist}</p>
        {snippet && (
          <details className="mt-0.5">
            <summary className="cursor-pointer select-none text-[11.5px] text-[var(--fg-4)] hover:text-[var(--fg-2)]">
              texte original
            </summary>
            <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--fg-4)]">{snippet}</p>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="mt-1">
      {snippet && <p className="text-[12px] leading-relaxed text-[var(--fg-4)]">{snippet}</p>}
      {busy && (
        <p className="mt-0.5 text-[11.5px] text-amber-300">résumé en français en cours…</p>
      )}
      {failed && (
        <p className="mt-0.5 text-[11.5px] text-[var(--fg-4)]">
          pas de résumé français (le rédacteur n&apos;a pas répondu){' '}
          <button
            type="button"
            className="underline hover:text-[var(--fg-2)]"
            onClick={() => setFailed(false)}
          >
            réessayer
          </button>
        </p>
      )}
      {/* A row that has not been asked for is the only one still offering the
          link: wanting a gist is what starts the request, so !wanted implies
          nothing has failed yet. */}
      {!wanted && (
        <button
          type="button"
          onClick={() => setWanted(true)}
          className="mt-0.5 text-[11.5px] text-amber-400 underline underline-offset-2 hover:text-amber-300"
        >
          résumer en français
        </button>
      )}
    </div>
  );
}
