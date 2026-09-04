'use client';

import { useEffect, useState } from 'react';

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
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [attempted, setAttempted] = useState(false);

  async function translate() {
    setState('busy');
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
        setState('idle');
      } else setState('failed');
    } catch {
      setState('failed');
    } finally {
      release();
    }
  }

  // Automatic: the first render of an untranslated row asks once. A failure
  // leaves a retry link rather than looping on a writer that is down.
  useEffect(() => {
    if (!body || fr || attempted) return;
    setAttempted(true);
    void translate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, fr, attempted]);

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
        {fr ? ' (français et original)' : state === 'busy' ? ' (traduction en cours…)' : ''}
      </summary>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-3)]">
            <span>Français</span>
            {state === 'busy' && (
              <span className="font-normal normal-case tracking-normal text-amber-300">
                traduction en cours…
              </span>
            )}
            {state === 'failed' && (
              <span className="font-normal normal-case tracking-normal text-red-300">
                le traducteur n&apos;a pas répondu,{' '}
                <button type="button" onClick={() => void translate()} className="underline">
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
