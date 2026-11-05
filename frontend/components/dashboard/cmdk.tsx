'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { localePath } from '@/lib/locale-path';
import styles from './workspace.module.css';

interface IndexRow {
  email: string;
  label: string;
  kind: 'client' | 'prospect';
}

/** Recherche à la demande, dans un dialogue qui garde le clavier et rend le focus. */
export function CommandPalette() {
  const locale = useLocale();
  const t = useTranslations('dashboard.workspace');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<IndexRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [partial, setPartial] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setQ('');
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
        setQ('');
      }
    }
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('ibf-open-cmdk', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('ibf-open-cmdk', onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      input.current?.focus();
    } else dialog.current?.close();
  }, [open]);

  useEffect(() => {
    if (!open || rows !== null || failed) return;
    const controller = new AbortController();
    fetch('/api/crm/search-index', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('index_indisponible');
        const data = (await response.json()) as { rows?: IndexRow[]; partial?: boolean };
        if (
          !Array.isArray(data.rows) ||
          data.rows.some(
            (row) =>
              typeof row?.email !== 'string' ||
              typeof row?.label !== 'string' ||
              !['client', 'prospect'].includes(row.kind),
          )
        )
          throw new Error('index_invalide');
        if (!controller.signal.aborted) {
          setRows(data.rows);
          setPartial(data.partial === true);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [open, rows, failed]);

  const hits = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (rows ?? [])
      .filter(
        (row) =>
          !term || row.email.toLowerCase().includes(term) || row.label.toLowerCase().includes(term),
      )
      .slice(0, 8);
  }, [rows, q]);

  const go = (row: IndexRow, home: 'contacts' | 'clients') => {
    close();
    window.location.href = localePath(
      locale,
      home === 'contacts'
        ? `/dashboard/contacts?client=${encodeURIComponent(row.email)}`
        : `/dashboard/clients?open=${encodeURIComponent(row.email)}`,
    );
  };

  return (
    <dialog
      ref={dialog}
      className={styles.searchDialog}
      aria-label={t('search')}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        // WebKit peut ignorer les boutons avec le réglage clavier par défaut du Mac.
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>('input, button:not(:disabled)'),
        ];
        const index = controls.indexOf(document.activeElement as HTMLElement);
        if (controls.length) {
          event.preventDefault();
          controls[
            (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
          ]?.focus();
        }
      }}
      onCancel={close}
      onClose={close}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-[var(--ink-4)] px-4 py-3">
          <input
            ref={input}
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing && hits[0])
                go(hits[0], 'contacts');
            }}
            aria-label={t('searchInput')}
            placeholder={t('searchInput')}
            className="min-h-11 min-w-0 flex-1 bg-transparent text-base text-[var(--fg-1)] placeholder:text-[var(--fg-4)]"
          />
          <button
            type="button"
            onClick={close}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-[var(--ink-4)]"
            aria-label={t('closeSearch')}
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        {failed && (
          <div role="alert" className="p-4 text-sm">
            <p>{t('searchUnavailable')}</p>
            <button
              type="button"
              className="mt-3 min-h-11 rounded-lg border border-[var(--ink-5)] px-4"
              onClick={() => setFailed(false)}
            >
              {t('retry')}
            </button>
          </div>
        )}
        {partial && (
          <p role="status" className="px-4 py-3 text-sm text-[var(--work-amber)]">
            {t('searchPartial')}
          </p>
        )}
        <ul className="max-h-[55dvh] overflow-y-auto" aria-live="polite">
          {rows === null && !failed && (
            <li className="px-4 py-3 text-sm text-[var(--fg-4)]">{t('loading')}</li>
          )}
          {rows !== null && hits.length === 0 && (
            <li className="px-4 py-3 text-sm text-[var(--fg-4)]">{t('noResult')}</li>
          )}
          {hits.map((row) => (
            <li
              key={row.email}
              className="flex flex-wrap items-center gap-2 border-b border-[var(--ink-4)] px-4 py-3 last:border-0"
            >
              <span className="min-w-0 flex-1 basis-40">
                <span className="block truncate text-sm font-medium">{row.label}</span>
                <span className="block truncate text-xs text-[var(--fg-4)]">{row.email}</span>
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => go(row, 'contacts')}
                  className={styles.resultButton}
                >
                  {t('thread')}
                </button>
                {row.kind === 'client' && (
                  <button
                    type="button"
                    onClick={() => go(row, 'clients')}
                    className={styles.resultButton}
                  >
                    {t('file')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="border-t border-[var(--ink-4)] px-4 py-3 text-xs text-[var(--fg-4)]">
          {t('searchKeys')}
        </p>
      </div>
    </dialog>
  );
}
