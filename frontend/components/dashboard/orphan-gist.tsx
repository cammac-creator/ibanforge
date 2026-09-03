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
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [wanted, setWanted] = useState(eager);

  useEffect(() => {
    if (gist || !wanted || state !== 'idle') return;
    let alive = true;
    setState('busy');
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
        if (r.ok && data.gist_fr) {
          setGist(data.gist_fr);
          setState('idle');
        } else setState('failed');
      } catch {
        if (alive) setState('failed');
      } finally {
        release();
      }
    })();
    return () => {
      alive = false;
    };
  }, [gist, wanted, state, id, sender, subject, snippet, msgDate]);

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
      {state === 'busy' && (
        <p className="mt-0.5 text-[11.5px] text-amber-300">résumé en français en cours…</p>
      )}
      {state === 'failed' && (
        <p className="mt-0.5 text-[11.5px] text-[var(--fg-4)]">
          pas de résumé français (le rédacteur n&apos;a pas répondu){' '}
          <button
            type="button"
            className="underline hover:text-[var(--fg-2)]"
            onClick={() => setState('idle')}
          >
            réessayer
          </button>
        </p>
      )}
      {state === 'idle' && !wanted && (
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
