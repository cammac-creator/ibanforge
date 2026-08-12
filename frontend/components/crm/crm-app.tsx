'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CLIENT_PARAM, contactIdFromParam } from '@/lib/crm/deep-link';
import { intentOf } from '@/lib/crm/intent';
import type { Contact, Message, Situation } from '@/lib/crm/types';
import { ContactDetail, ContactIdentity } from './contact-header';
import { DraftCard } from './draft-card';
import { MailList } from './mail-list';
import { OUTBOUND_SHEET_COVER_PX, OutboundSheet } from './outbound-sheet';
import { REPLY_SHEET_COVER_PX, ReplySheet } from './reply-sheet';
import { SituationBand } from './situation-band';
import { ThreadSummary } from './thread-summary';
import { Thread } from './thread';

/**
 * How tall the thread pane stands, as one value rather than a number scattered
 * over the file.
 *
 * Posed by arithmetic, from the real top of the pane. The context line is the
 * only thing above it now, so on the ordinary window: the top bar is 57px
 * (py-3 around a 32px tab row, plus its bottom border), the dashboard's main
 * pads 32px at the md breakpoint, the context line is one 24px row and the
 * page's gap-5 adds 20. That is 133px above the pane, and 9rem leaves the foot
 * of the pane just short of the fold.
 *
 * It replaces a 76vh cap that was sized for a page carrying a podium, six
 * figure cards and a campaign band above the CRM. With those gone the cap left
 * a quarter of the window empty under the thread.
 *
 * It could not be measured where it was written: the dashboard is behind a
 * login and the CRM reads live data through an admin secret, and a development
 * checkout carries neither. So it is posed by arithmetic, in one place, and
 * checked against a real window on a deploy preview. One constant is what makes
 * that check a one-line correction rather than a hunt.
 */
const PANE_HEIGHT = 'h-[calc(100vh-9rem)]';

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
  snoozed,
  sentToday,
}: {
  contacts: Contact[];
  /** Keyed by Contact.id, one entry per contact, built by the page. */
  situations: Record<string, Situation>;
  /**
   * One entry per contact id, computed by the page against the same clock as
   * the situations. Never derived here: a boolean about "what day is it"
   * recomputed in the browser is a hydration mismatch waiting for midnight.
   */
  snoozed: Record<string, boolean>;
  /** Real outbound mails dated today, counted by the page against one clock. */
  sentToday: number;
}) {
  // Arriving from the Clients tab, the address to open travels in the query
  // string. Read once, as the initial value rather than in an effect, so the
  // thread is already there on the first paint instead of flashing the empty
  // pane. Server and browser see the same URL, so the two renders agree.
  const searchParams = useSearchParams();
  const linked = contactIdFromParam(
    searchParams.get(CLIENT_PARAM),
    contacts.map((c) => c.id),
  );
  const [selectedId, setSelectedId] = useState<string | null>(linked);
  const [readLocal, setReadLocal] = useState<Set<string>>(new Set());
  // Owned here rather than in the sheets: opening one decides how much scroll
  // room the thread has to hand back, and the thread has to be re-anchored on
  // its newest message afterwards, which only an effect that depends on this
  // can do.
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

  // Memoised: the projection clones every contact read this session, so
  // without the memo each render of this component would hand the tree below
  // fresh objects to reconcile. The list's search costs nothing here either
  // way: its state lives in MailList, so typing re-renders that column alone.
  //
  // A thread arrived at by link counts as read exactly like one arrived at by
  // click, and that is derived here rather than pushed into readLocal from an
  // effect: the badge is a function of what is open, not a second copy of it.
  // Clearing unread also re-ranks the row: "À répondre" sorts unread first
  // (mail-rows.ts), so the linked thread yields the top of that filter the
  // moment it opens. Intended, and not new: a click clears the badge through
  // readLocal and moves the row the same way.
  const view = useMemo(
    () => contacts.map((c) => (readLocal.has(c.id) || c.id === linked ? { ...c, unread: false } : c)),
    [contacts, readLocal, linked],
  );

  const selected = view.find((c) => c.id === selectedId) ?? null;
  const situation = selected ? situations[selected.id] : undefined;
  /**
   * Which of the two writing paths this contact is on. Read once here and
   * nowhere else in this tree: the sheet that is rendered and the room the
   * thread reserves for it have to agree, and two readings are two answers
   * waiting to disagree.
   */
  const intent = intentOf(situation);

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

  // Telling the server the linked thread was read. Only the network call lives
  // here, since the badge itself is derived above, and the ref makes it fire
  // once per address rather than on every re-render.
  const readPosted = useRef<string | null>(null);
  useEffect(() => {
    if (!linked || readPosted.current === linked) return;
    const c = contacts.find((x) => x.id === linked);
    if (!c?.unread || !c.email) return;
    readPosted.current = linked;
    void fetch('/api/crm/thread-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: c.email }),
    }).catch(() => {});
  }, [linked, contacts]);

  // The draft card counts: on a contact with no correspondence it is the one
  // thing at the end of the region that has to be seen.
  const tailCount = (selected?.messages.length ?? 0) + (selected?.draft ? 1 : 0);
  useEffect(() => {
    const el = scroller.current;
    if (el && tailCount > 0) el.scrollTop = el.scrollHeight;
  }, [selectedId, tailCount, composerOpen]);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-0 lg:grid-cols-[296px_1fr]">
      {/* First column, and a sibling of the thread rather than anything inside
          it: on a desktop the day's queue stays on screen while the operator
          moves from contact to contact. Below lg the page shows ONE screen at
          a time, native-mail style: the list, or the open thread with a back
          control — stacking both made the phone scroll through the whole
          queue before reaching the conversation. */}
      <div className={selected ? 'hidden lg:flex lg:flex-col' : 'flex flex-col'}>
      <MailList
        input={{ contacts: view, situations, snoozed }}
        selectedId={selectedId}
        onSelect={open}
      />
      </div>
      {/* Positioned, so the writing sheet can float over its foot. Whichever of
          the two is rendered, it is the only absolutely positioned thing in
          here, and without this it would anchor itself to the page instead.

          The p-4 below is counted on: both sheets subtract it from their
          heights as PANEL_PADDING_PX (panel-padding.ts). A class cannot read
          a constant, so nothing enforces the pair; change this padding and
          that constant must change with it. */}
      <div
        className={`relative min-w-0 ${PANE_HEIGHT} flex-col rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/40 p-4 ${selected ? 'flex' : 'hidden lg:flex'}`}
      >
        {selected && (
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="mb-2 self-start rounded-lg border border-[var(--ink-4)] px-2.5 py-1 text-[13px] text-[var(--fg-2)] hover:text-[var(--fg-1)] lg:hidden"
          >
            ← Contacts
          </button>
        )}
        {!selected ? (
          // "dans la liste", not "à gauche": below the lg breakpoint the list
          // sits above this pane, not beside it.
          <div className="flex h-64 items-center justify-center text-center text-sm text-[var(--fg-3)]">
            Sélectionne un contact dans la liste.
          </div>
        ) : (
          <>
            {/* Pinned: who this is, and what to do about them. Everything else
                scrolls. It is a tall thing to pin, and it is what made the
                writing surface float: measured with this header pinned, its
                370px against a 265px composer that sat in the flow left the
                thread 0px inside the 76vh panel, on the most ordinary window
                there is. The banner in particular has to stay: its job is to
                answer "what next" at the moment the operator decides what to
                write. */}
            <ContactIdentity contact={selected} />
            {situation && (
              <div className="mt-3">
                <SituationBand situation={situation} />
              </div>
            )}
            {/* Pinned with the band, not scrolled with the thread: the whole
                point is to spare the re-read, so it must be visible before
                any scrolling happens. Only earns its pixels on real threads. */}
            {selected.messages.length >= 4 && selected.email && (
              <ThreadSummary
                key={selected.id}
                email={selected.email}
                company={selected.company}
                messages={selected.messages}
              />
            )}
            {/* The room the open sheet covers, handed back as scroll space.
                The sheet floats, so this region keeps its full height, but the
                effect above scrolls it to its very end and that end would sit
                behind the sheet. This padding is what lets the newest message
                rise above it. Each sheet declares what it covers, and the two
                differ: prospecting writes in six rows where an answer takes
                four. Nothing is reserved while both are folded, since a folded
                bar sits in the flow and covers nothing. */}
            <div
              ref={scroller}
              style={
                composerOpen
                  ? {
                      paddingBottom:
                        intent === 'reply' ? REPLY_SHEET_COVER_PX : OUTBOUND_SHEET_COVER_PX,
                    }
                  : undefined
              }
              className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1"
            >
              <ContactDetail contact={selected} situation={situation} />
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
                      // The card sends too, so it gets the same two values the
                      // composer gets, from the same single snapshot.
                      situation={situation}
                      sentToday={sentToday}
                    />
                  ) : null
                }
              />
            </div>
            {/* Outside the scrolling region on purpose: writing stays reachable
                wherever the thread is scrolled. Keyed on the contact, for the
                sharper version of the same reason as the card above: text left
                in the composer must never follow the operator to the next
                contact and be sent to them.

                Two paths and not one. Answering somebody who wrote to us has
                nothing to choose and nothing to prospect, so it gets a short
                sheet and the two checks that still apply. A mail nobody asked
                for gets the angles, the pre-written mail, the draft and the
                whole rule set. Both float over this panel; only the height
                they cover differs. */}
            {intent === 'reply' ? (
              <ReplySheet
                key={selected.id}
                contact={selected}
                situation={situation}
                // The page's count, forwarded untouched: the guardrail that caps
                // the day reads it, and nothing below this line builds a Date.
                sentToday={sentToday}
                open={composerOpen}
                onOpenChange={setComposerOpen}
              />
            ) : (
              <OutboundSheet
                key={selected.id}
                contact={selected}
                situation={situation}
                sentToday={sentToday}
                open={composerOpen}
                onOpenChange={setComposerOpen}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
