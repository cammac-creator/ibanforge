'use client';

import { useEffect, useState } from 'react';

/**
 * The working memory that was nowhere: "migre depuis iban.com, décision en
 * septembre" finally has a place to live. Dated notes per address, shown in
 * both dossiers, and read back into every AI draft brief — what the operator
 * knows, the writer knows.
 */
interface Note {
  id: number;
  note: string;
  created_at: string;
}

export function ContactNotes({ email }: { email: string }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setNotes(null);
    fetch(`/api/crm/contact-notes?email=${encodeURIComponent(email)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { notes?: Note[] } | null) => {
        if (!cancelled) setNotes(j?.notes ?? []);
      })
      .catch(() => {
        if (!cancelled) setNotes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [email]);

  async function add() {
    const note = draft.trim();
    if (!note || busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/crm/contact-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, note }),
      });
      if (r.ok) {
        const { id } = (await r.json()) as { id: number };
        setNotes((prev) => [{ id, note, created_at: new Date().toISOString() }, ...(prev ?? [])]);
        setDraft('');
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/crm/contact-notes?id=${id}`, { method: 'DELETE' });
      if (r.ok) setNotes((prev) => (prev ?? []).filter((n) => n.id !== id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-[var(--fg-4)]">
        📝 Notes{' '}
        <span className="font-normal normal-case tracking-normal text-[var(--fg-5)]">
          privées, lues par les brouillons IA
        </span>
      </p>
      <div className="flex items-start gap-1.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add();
          }}
          rows={1}
          placeholder="Noter un fait… (⌘⏎ pour enregistrer)"
          className="min-w-0 flex-1 resize-y rounded-md border border-[var(--ink-4)] bg-[var(--ink-0)] px-2.5 py-1.5 text-base leading-snug text-[var(--fg-1)] placeholder:text-[var(--fg-5)] focus:border-[var(--amber-500)]/50 focus:outline-none sm:text-[13px]"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim() || busy}
          className="shrink-0 rounded-md border border-[var(--amber-500)]/40 px-2.5 py-1.5 text-[12.5px] font-medium text-[var(--amber-400)] hover:bg-[var(--amber-500)]/10 disabled:opacity-40"
        >
          Noter
        </button>
      </div>
      {notes === null ? (
        <p className="mt-2 text-[12px] text-[var(--fg-5)]">…</p>
      ) : notes.length === 0 ? null : (
        <ul className="mt-2 space-y-1.5">
          {notes.map((n) => (
            <li
              key={n.id}
              className="group flex items-start gap-2 rounded-md bg-[var(--ink-2)]/60 px-2.5 py-1.5"
            >
              <span className="min-w-0 flex-1 whitespace-pre-wrap text-[13px] leading-snug text-[var(--fg-2)]">
                {n.note}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-[var(--fg-3)]">
                {n.created_at.slice(0, 10)}
              </span>
              <button
                type="button"
                onClick={() => remove(n.id)}
                title="Supprimer cette note"
                className="invisible shrink-0 text-[12px] text-[var(--fg-5)] hover:text-[var(--err)] group-hover:visible"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
