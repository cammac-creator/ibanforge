'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Contact, Message, Situation } from '@/lib/crm/types';
import { ComposerDock } from './composer-dock';
import { ContactDetail, ContactIdentity } from './contact-header';
import { ContactList } from './contact-list';
import { DraftCard } from './draft-card';
import { SituationBand } from './situation-band';
import { Thread } from './thread';
import { TodayRail } from './today-rail';

/**
 * Identity of a draft as displayed. The stored id is derived from the address
 * alone and therefore never changes when the draft is overwritten, so it
 * cannot be the React key on its own. The date alone is not enough either: it
 * has minute resolution, so two saves within the same minute share it. The
 * text is what the card shows, so the text takes part in its identity.
 */
function draftKey(contactId: string, draft: Message): string {
  return `${contactId}|${draft.msg_date ?? ''}|${draft.subject ?? ''}|${draft.snippet ?? ''}`;
}

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
  sentToday,
}: {
  contacts: Contact[];
  /** Keyed by Contact.id, one entry per contact, built by the page. */
  situations: Record<string, Situation>;
  /** Real outbound mails dated today, counted by the page against one clock. */
  sentToday: number;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [readLocal, setReadLocal] = useState<Set<string>>(new Set());
  // Owned here rather than in the dock: folding changes how tall the thread is,
  // and the thread has to be re-anchored on its newest message afterwards,
  // which only an effect that depends on this can do.
  const [composerOpen, setComposerOpen] = useState(false);

  // Same behaviour as the workspace this replaces: opening a thread clears its
  // badge at once, locally, and tells the API in the background. A failed call
  // is swallowed: the badge comes back on the next load, which is the harmless
  // outcome, whereas blocking the click on a network round trip is not.
  function open(id: string) {
    setSelectedId(id);
    // Opening a contact is a reading act. The composer comes back to rest.
    setComposerOpen(false);
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

  // The scrolling region holds the dossier and then the thread, oldest message
  // first, so its natural resting place is the top: the dossier. What the
  // operator opens a thread to see is the last message, and after a send it is
  // the one that just appeared. Hence the jump to the end on a change of
  // contact or of message count.
  //
  // Guarded on there being an end worth jumping to, which is what keeps the
  // dossier where it matters: a cold prospect has no message and no draft by
  // definition, and it is exactly then that the buying signal and the hook are
  // what the operator is writing from, so nothing scrolls and they stay in
  // view. A warm contact scrolls, and its dossier is one scroll up.
  const scroller = useRef<HTMLDivElement>(null);
  // The draft card counts: on a contact with no correspondence it is the one
  // thing at the end of the region that has to be seen.
  const tailCount = (selected?.messages.length ?? 0) + (selected?.draft ? 1 : 0);
  useEffect(() => {
    const el = scroller.current;
    if (el && tailCount > 0) el.scrollTop = el.scrollHeight;
  }, [selectedId, tailCount, composerOpen]);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[170px_260px_1fr]">
      {/* First column, and a sibling of the thread rather than anything inside
          it: the day's queue has to stay on screen while the operator moves
          from contact to contact. Below lg the three columns stack and it
          comes first, which is the same claim on a phone. */}
      <TodayRail
        contacts={view}
        situations={situations}
        sentToday={sentToday}
        selectedId={selectedId}
        onSelect={open}
      />
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
            {/* Pinned: who this is, and what to do about them. Everything else
                scrolls. Measured with the whole header pinned, a 370px header
                against a 265px open composer left the thread 0px inside the
                76vh panel, on the most ordinary window there is. The banner in
                particular has to stay: its job is to answer "what next" at the
                moment the operator decides what to write. */}
            <ContactIdentity contact={selected} />
            {situation && (
              <div className="mt-3">
                <SituationBand situation={situation} />
              </div>
            )}
            <div ref={scroller} className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
              <ContactDetail contact={selected} />
              <Thread
                messages={selected.messages}
                // Without this the contact's bubbles are labelled 'lui'. An
                // address-less prospect has neither, so the fallback stands.
                counterpartLabel={selected.company || selected.email || undefined}
                draftSlot={
                  selected.draft ? (
                    // Keyed on the draft's content, not only on the contact.
                    // DraftCard seeds its editable text from props on mount, so
                    // an unkeyed card would keep the previous contact's text
                    // after a selection change, and stale text after the
                    // composer overwrote the draft. Both would offer a send
                    // button on something the operator is not reading.
                    <DraftCard
                      key={draftKey(selected.id, selected.draft)}
                      contact={selected}
                      draft={selected.draft}
                    />
                  ) : null
                }
              />
            </div>
            {/* Outside the scrolling region on purpose: writing stays reachable
                wherever the thread is scrolled. Keyed on the contact, for the
                sharper version of the same reason as the card above: text left
                in the composer must never follow the operator to the next
                contact and be sent to them. */}
            <ComposerDock
              key={selected.id}
              contact={selected}
              situation={situation}
              // The page's count, forwarded untouched: the guardrail that caps
              // the day reads it, and nothing below this line builds a Date.
              sentToday={sentToday}
              open={composerOpen}
              onOpenChange={setComposerOpen}
            />
          </>
        )}
      </div>
    </div>
  );
}
