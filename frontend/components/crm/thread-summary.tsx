'use client';

import { useEffect, useState } from 'react';
import type { Message } from '@/lib/crm/types';

/**
 * "Où on en est" — two to three French lines pinned above a long thread, so
 * reopening a 12-message conversation costs a glance instead of a re-read.
 *
 * Cache-first by thread state: the key is the message count plus the last
 * message's date, so a new mail (in or out) is exactly what invalidates it.
 * Generation happens at most once per key, and a failure degrades to
 * nothing — the thread itself is always the fallback.
 */
export function threadKeyOf(messages: Message[]): string {
  return `${messages.length}|${messages.at(-1)?.msg_date ?? ''}`;
}

export function ThreadSummary({
  email,
  company,
  messages,
}: {
  email: string;
  company: string | null;
  messages: Message[];
}) {
  const key = threadKeyOf(messages);
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setState('loading');
    (async () => {
      try {
        const hit = await fetch(
          `/api/crm/thread-summary?email=${encodeURIComponent(email)}&key=${encodeURIComponent(key)}`,
        ).then((r) => (r.ok ? r.json() : null));
        if (cancelled) return;
        const cached = (hit as { summary?: { summary_fr?: string } | null } | null)?.summary?.summary_fr;
        if (cached) {
          setText(cached);
          setState('idle');
          return;
        }
        const gen = await fetch('/api/crm/thread-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            key,
            company,
            messages: messages.slice(-30).map((m) => ({
              direction: m.direction,
              date: m.msg_date,
              subject: m.subject,
              snippet: m.snippet_fr ?? m.snippet,
            })),
          }),
        }).then((r) => (r.ok ? r.json() : null));
        if (cancelled) return;
        const fresh = (gen as { summary?: { summary_fr?: string } } | null)?.summary?.summary_fr;
        if (fresh) {
          setText(fresh);
          setState('idle');
        } else {
          setState('failed');
        }
      } catch {
        if (!cancelled) setState('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [email, key, company, messages]);

  // Silence over apology: a failed or pending summary renders a thin line or
  // nothing, never an error card — the thread below is the source of truth.
  if (state === 'failed') return null;
  return (
    <div className="mt-2 rounded-lg border border-violet-500/25 bg-violet-500/[0.06] px-3 py-2">
      {text ? (
        <p className="text-[13px] leading-relaxed text-violet-200">
          <span className="font-semibold">📌 Où on en est</span> · {text}
        </p>
      ) : (
        <p className="text-[12px] text-violet-300/60">📌 Résumé du fil en cours d'écriture…</p>
      )}
    </div>
  );
}
