'use client';

import { useState } from 'react';

export interface ThreadMessage {
  direction: 'in' | 'out';
  msg_date: string | null;
  subject: string | null;
  snippet: string | null;
  counterparty: string | null;
}

export type ThreadStatus = 'replied' | 'awaiting' | 'followup_due' | 'not_contacted';

const STATUS: Record<ThreadStatus, { label: string; color: string; bg: string }> = {
  replied: { label: 'A répondu', color: '#22c55e', bg: '#052e16' },
  awaiting: { label: 'En attente', color: '#3b82f6', bg: '#172554' },
  followup_due: { label: 'Relance due', color: '#f59e0b', bg: '#451a03' },
  not_contacted: { label: 'À contacter', color: '#a1a1aa', bg: '#27272a' },
};

/** Per-customer follow-up status badge + click-to-open conversation modal. */
export function CustomerThread({
  name,
  status,
  messages,
}: {
  name: string;
  status: ThreadStatus;
  messages: ThreadMessage[];
}) {
  const [open, setOpen] = useState(false);
  const s = STATUS[status];
  const has = messages.length > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => has && setOpen(true)}
        disabled={!has}
        className={`inline-flex items-center gap-2 ${has ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ color: s.color, backgroundColor: s.bg }}
        >
          {s.label}
        </span>
        {has && <span className="text-[11px] text-[var(--fg-4)] underline decoration-dotted">{messages.length} msg</span>}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">{name}</p>
                <p className="text-[11px] text-[var(--fg-4)]">{messages.length} message(s) · fil complet</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-lg text-[var(--fg-4)] hover:text-white">
                ✕
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`rounded-lg border p-3 ${
                    m.direction === 'in'
                      ? 'border-[var(--ink-5)] bg-[var(--ink-4)]/40'
                      : 'ml-6 border-amber-500/30 bg-amber-500/5'
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between text-[10px] text-[var(--fg-4)]">
                    <span className={m.direction === 'in' ? 'text-blue-400' : 'text-amber-400'}>
                      {m.direction === 'in' ? '← reçu' : '→ envoyé'}
                    </span>
                    <span>{m.msg_date}</span>
                  </div>
                  <p className="text-xs font-medium text-[var(--fg-1)]">{m.subject || '(sans objet)'}</p>
                  {m.snippet && <p className="mt-1 text-[11px] leading-relaxed text-[var(--fg-3)]">{m.snippet}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
