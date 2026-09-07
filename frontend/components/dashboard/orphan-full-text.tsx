'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The whole mail: the original text as the sync stored it and its French
 * translation. The sync translates a new orphan as it arrives; a row that
 * reached the dashboard untranslated (a sync before 03/09/2026, or a
 * translator hiccup) asks for its translation by itself, two at a time.
 * Folded by default: the gist above answers "what is this" for most rows,
 * and a queue that unfolds eighteen full mails at once is not a queue.
 *
 * A row synced before 03/09/2026 has no body yet: the sync re-sends its
 * window every fifteen minutes, so the text arrives on its own.
 */

// Two writer calls in flight across the panel, same discipline as the gist.
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

export function OrphanFullText({
  id,
  body,
  initialFr,
}: {
  id: string;
  body: string | null;
  initialFr: string | null;
}) {
  const [fr, setFr] = useState<string | null>(initialFr);
  const [lang, setLang] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /**
   * « In flight » is not a state of its own: a row with a text, no translation
   * and no failure behind it is one the writer is working on — that is exactly
   * when the request below is running. Held as state, it had to be written
   * from the effect body, which buys a second render for a fact the first one
   * already knew (react-hooks/set-state-in-effect, rules turned on
   * 2026-09-07). Derived, « traduction en cours… » is on screen from the
   * render that fires the request rather than the one after it.
   */
  const busy = !!body && !fr && !failed;
  // One automatic attempt per row, latched. A ref rather than state: nothing
  // renders it, and it is only read and written from the effect below.
  const started = useRef(false);

  /**
   * The request. It touches no state before its first await, which is what
   * lets the effect fire it without queueing a render behind itself.
   */
  async function run() {
    await acquire();
    try {
      const r = await fetch('/api/crm/orphan-translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, text: body }),
      });
      const data = (await r.json().catch(() => ({}))) as { body_fr?: string; lang?: string | null };
      if (r.ok && data.body_fr) {
        setFr(data.body_fr);
        setLang(data.lang ?? null);
      } else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      release();
    }
  }

  /** The retry link: clears the failure, which is what puts the row back in
   *  flight, then asks again. */
  function retry() {
    setFailed(false);
    void run();
  }

  // Automatic: the first render of an untranslated row asks once. A failure
  // leaves a retry link rather than looping on a writer that is down.
  useEffect(() => {
    if (!body || fr || started.current) return;
    started.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, fr]);

  if (!body) {
    return (
      <p className="mt-1 text-[11.5px] text-[var(--fg-4)]">
        texte complet disponible à la prochaine synchro (au plus 15 min)
      </p>
    );
  }

  // No inner scroll: the page already scrolls, and two columns each scrolling
  // on their own desynchronised the side-by-side reading at the first screen
  // (three scrollbars for one mail). The French is what is read; it gets the
  // reading size, the original the reference size.
  const block =
    'whitespace-pre-wrap rounded border border-[var(--ink-4)]/60 bg-[var(--ink-0)] p-2.5 leading-relaxed wrap-anywhere';

  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer select-none text-[12px] text-amber-400 hover:text-amber-300">
        mail complet
        {fr ? ' (français et original)' : busy ? ' (traduction en cours…)' : ''}
      </summary>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-3)]">
            <span>Français</span>
            {busy && (
              <span className="font-normal normal-case tracking-normal text-amber-300">
                traduction en cours…
              </span>
            )}
            {failed && (
              <span className="font-normal normal-case tracking-normal text-red-300">
                le traducteur n&apos;a pas répondu,{' '}
                <button type="button" onClick={retry} className="underline">
                  réessayer
                </button>
              </span>
            )}
          </div>
          {fr ? (
            <div className={`${block} text-[14px] text-[var(--fg-1)]`}>{fr}</div>
          ) : (
            <p className="text-[11.5px] text-[var(--fg-4)]">traduction à venir</p>
          )}
        </div>
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-3)]">
            Original{lang ? ` (${lang})` : ''}
          </div>
          <div className={`${block} text-[12.5px] text-[var(--fg-2)]`}>{body}</div>
        </div>
      </div>
    </details>
  );
}
