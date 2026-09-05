'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { localePath } from '@/lib/locale-path';

/**
 * ⌘K: from "I'm thinking of Société Alpha" to their file in two keystrokes,
 * from any tab. The index is deliberately thin (name, domain, email — no messages, no
 * series) so the first keypress is instant; each hit offers its two homes:
 * the conversation (Contacts) and the usage file (Clients).
 */
interface IndexRow {
  email: string;
  label: string;
  kind: 'client' | 'prospect';
}

export function CommandPalette() {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<IndexRow[] | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQ('');
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQ('');
      }
      if (e.key === 'Escape') {
        setOpen(false);
        setQ('');
      }
    }
    window.addEventListener('keydown', onKey);
    const onOpen = () => setOpen(true);
    window.addEventListener('ibf-open-cmdk', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('ibf-open-cmdk', onOpen);
    };
  }, []);

  // The index loads on first open. Everything in this effect is asynchronous
  // (fetch then setState), which is the shape the strict hooks rule expects.
  useEffect(() => {
    if (!open || rows !== null) return;
    let cancelled = false;
    fetch('/api/crm/search-index')
      .then(async (r) => {
        const data = r.ok ? ((await r.json()) as { rows?: IndexRow[] }) : {};
        if (!cancelled) setRows(data.rows ?? []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, rows]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  const hits = useMemo(() => {
    if (!rows) return [];
    const term = q.trim().toLowerCase();
    if (!term) return rows.slice(0, 8);
    return rows.filter((r) => r.email.includes(term) || r.label.toLowerCase().includes(term)).slice(0, 8);
  }, [rows, q]);

  const go = useCallback(
    (row: IndexRow, home: 'contacts' | 'clients') => {
      setOpen(false);
      // `client` is the Contacts deep-link contract (lib/crm/deep-link.ts);
      // `open` is the Clients-side equivalent added with this palette.
      window.location.href =
        home === 'contacts'
          ? localePath(locale, `/dashboard/contacts?client=${encodeURIComponent(row.email)}`)
          : localePath(locale, `/dashboard/clients?open=${encodeURIComponent(row.email)}`);
    },
    [locale],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 p-4 pt-[12vh]"
      onClick={close}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-[var(--ink-4)] bg-[var(--ink-1)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits[0]) go(hits[0], 'contacts');
          }}
          placeholder="Nom, société, adresse… (Entrée = ouvrir le fil)"
          className="w-full border-b border-[var(--ink-4)] bg-transparent px-4 py-3 text-base text-[var(--fg-1)] placeholder:text-[var(--fg-5)] focus:outline-none"
        />
        <ul className="max-h-[50vh] overflow-y-auto">
          {rows === null && <li className="px-4 py-3 text-sm text-[var(--fg-4)]">Chargement…</li>}
          {rows !== null && hits.length === 0 && (
            <li className="px-4 py-3 text-sm text-[var(--fg-4)]">Personne ne correspond.</li>
          )}
          {hits.map((r) => (
            <li
              key={r.email}
              className="flex items-center gap-2 border-b border-[var(--ink-4)]/40 px-4 py-2.5 last:border-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--fg-1)]">{r.label}</span>
                <span className="block truncate font-mono text-[11.5px] text-[var(--fg-4)]">{r.email}</span>
              </span>
              <button
                onClick={() => go(r, 'contacts')}
                className="rounded border border-[var(--ink-4)] px-2 py-1 text-[11.5px] text-[var(--fg-2)] hover:border-amber-500/50 hover:text-amber-400"
              >
                ✉ Fil
              </button>
              {r.kind === 'client' && (
                <button
                  onClick={() => go(r, 'clients')}
                  className="rounded border border-[var(--ink-4)] px-2 py-1 text-[11.5px] text-[var(--fg-2)] hover:border-amber-500/50 hover:text-amber-400"
                >
                  📊 Dossier
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="border-t border-[var(--ink-4)] px-4 py-1.5 text-[10.5px] text-[var(--fg-5)]">
          ⌘K pour ouvrir · Échap pour fermer · Entrée ouvre le fil du premier résultat
        </p>
      </div>
    </div>
  );
}
