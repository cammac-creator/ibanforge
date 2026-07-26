'use client';

import { useMemo, useState } from 'react';
import type { Contact, Situation } from '@/lib/crm/types';
import { ContactHeader } from './contact-header';
import { ContactList } from './contact-list';
import { SituationBand } from './situation-band';
import { Thread } from './thread';

/**
 * The two panes of the CRM: the contact column and the open thread. Selection
 * and the optimistic read flag are the only state, which is what puts the
 * client boundary here rather than deeper.
 *
 * Situations come down as a prop instead of being derived here. situationOf
 * reads the current instant and parses a stored date that carries no timezone,
 * so a UTC server and a browser in another zone would disagree on the silence
 * in days, and this subtree is server-rendered before it is hydrated. The page
 * computes them once against one clock; nothing below recomputes them.
 */
export function CrmApp({
  contacts,
  situations,
}: {
  contacts: Contact[];
  /** Keyed by Contact.id, one entry per contact, built by the page. */
  situations: Record<string, Situation>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [readLocal, setReadLocal] = useState<Set<string>>(new Set());

  // Same behaviour as the workspace this replaces: opening a thread clears its
  // badge at once, locally, and tells the API in the background. A failed call
  // is swallowed: the badge comes back on the next load, which is the harmless
  // outcome, whereas blocking the click on a network round trip is not.
  function open(id: string) {
    setSelectedId(id);
    const c = contacts.find((x) => x.id === id);
    if (c?.unread && !readLocal.has(id) && c.email) {
      setReadLocal((prev) => new Set(prev).add(id));
      void fetch('/api/crm/thread-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: c.email }),
      }).catch(() => {});
    }
  }

  // Memoised: a fresh array on every keystroke in the list's search box would
  // invalidate every memo down there for nothing.
  const view = useMemo(
    () => contacts.map((c) => (readLocal.has(c.id) ? { ...c, unread: false } : c)),
    [contacts, readLocal],
  );

  const selected = view.find((c) => c.id === selectedId) ?? null;
  const situation = selected ? situations[selected.id] : undefined;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
      <ContactList contacts={view} situations={situations} selectedId={selectedId} onSelect={open} />
      <div className="flex min-w-0 max-h-[76vh] flex-col rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/40 p-4">
        {!selected ? (
          // "dans la liste", not "à gauche": below the lg breakpoint the list
          // sits above this pane, not beside it.
          <div className="flex h-64 items-center justify-center text-center text-sm text-[var(--fg-3)]">
            Sélectionne un contact dans la liste.
          </div>
        ) : (
          <>
            <ContactHeader contact={selected} />
            {situation && (
              <div className="mt-3">
                <SituationBand situation={situation} />
              </div>
            )}
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
              <Thread
                messages={selected.messages}
                // Without this the contact's bubbles are labelled 'lui'. An
                // address-less prospect has neither, so the fallback stands.
                counterpartLabel={selected.company || selected.email || undefined}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
