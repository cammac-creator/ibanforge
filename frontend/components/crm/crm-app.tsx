'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CLIENT_PARAM, contactIdFromParam } from '@/lib/crm/deep-link';
import type { RowSelection } from '@/lib/crm/mail-rows';
import { intentOf } from '@/lib/crm/intent';
import { noReplyHolds } from '@/lib/crm/no-reply';
import type { Contact, Message, Situation } from '@/lib/crm/types';
import { ContactDetail, ContactIdentity } from './contact-header';
import { ContactDrawer, type CloseReason } from './contact-drawer';
import { ContactTable } from './contact-table';
import { DraftCard } from './draft-card';
import { OUTBOUND_SHEET_COVER_PX, OutboundSheet } from './outbound-sheet';
import { REPLY_SHEET_COVER_PX, ReplySheet } from './reply-sheet';
import { SituationBand } from './situation-band';
import { NoReplyControl } from './no-reply-control';
import { ThreadSummary } from './thread-summary';
import { Thread } from './thread';

/**
 * A short, stable digest of a string, so a key can depend on a whole mail
 * without carrying it. djb2: not a security hash, and it does not need to be —
 * what it protects against is two DIFFERENT texts sharing a React key, and the
 * length is carried beside it so the cheapest collisions cannot arise.
 */
function digest(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${s.length}.${h.toString(36)}`;
}

/**
 * Identity of a draft as displayed. The stored id is derived from the address
 * alone and therefore never changes when the draft is overwritten, so it
 * cannot be the React key on its own. The date alone is not enough either: it
 * has minute resolution, so two saves within the same minute share it. The
 * text is what the card shows, so the text takes part in its identity.
 *
 * The BODY, and only the snippet when there is no body. The snippet is stored
 * whitespace-collapsed and cut at 280 characters, while DraftCard seeds its
 * editable text from `body ?? snippet` and sends that state: keyed on the
 * snippet, two saves in the same minute under the same subject differing only
 * past character 280 — or only in whitespace — share a key, the card keeps the
 * OLD text while displaying the NEW one from the prop, and Envoyer sends what
 * the operator is not reading. That is precisely the failure this key exists to
 * prevent, so it has to hash what the card actually sends.
 */
function draftKey(contactId: string, draft: Message): string {
  const text = draft.body ?? draft.snippet ?? '';
  return `${contactId}|${draft.msg_date ?? ''}|${draft.subject ?? ''}|${digest(text)}`;
}

/**
 * The identity of "this contact, as it was when its badge was cleared".
 *
 * The optimistic read flag is a MASK over the server's answer, and a mask with
 * no expiry outlives the thing it mirrors: the payload refreshes on every hover
 * gesture, every send and every draft action, and a contact opened an hour ago
 * whose thread has since received a new inbound would keep rendering as read —
 * no dot, no weight, and no unread-first rank in the very queue built to
 * surface it — until a full page load. Composing the mark from the thread's
 * tail is what makes a newer message invalidate the mask by itself.
 */
function readMark(c: Contact): string {
  let last = '';
  for (let i = c.messages.length - 1; i >= 0; i -= 1) {
    const d = c.messages[i]?.msg_date;
    if (d) {
      last = d;
      break;
    }
  }
  return `${c.id}|${c.messages.length}|${last}`;
}

/**
 * The CRM: the contacts table across the whole page, and the open contact in a
 * drawer over it. Selection and the optimistic read flag are the only state,
 * which is what puts the client boundary here rather than deeper.
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
  woke = {},
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
  /** Sleepers whose wake date just arrived — same clock, same reason. */
  woke?: Record<string, boolean>;
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
  // ?vue=prospection lands the table on the prospecting queue — the nav's
  // Prospects entry survives the page merge as this deep link.
  // ?vue=correspondances does the same for the institutional filter, so a link
  // in a note or a bookmark can land straight on "where are the answers from
  // the authorities" without a click on a control whose name has to be
  // recalled.
  //
  // Same two URL keys and the same two landings, said in the toolbar's three
  // axes. Note which axis each one is: "À prospecter" is a refining CHIP over
  // the whole base, not the Prospects segment — the segment is the population,
  // and landing there would show every prospect already written to as well.
  const vue = searchParams.get('vue');
  // ?vue=reponses and ?vue=relances land on the two work tiles: they are what
  // the overview's counters point at, and a counter that arrives on the whole
  // base with its tile still to find is a number, not a link.
  const initialSelection: RowSelection | undefined =
    vue === 'prospection'
      ? { population: 'all', refine: 'prospect' }
      : vue === 'correspondances'
        ? { population: 'institution' }
        : vue === 'enrichir'
          ? { population: 'all', refine: 'enrich' }
          : vue === 'reponses'
            ? { population: 'all', work: 'reply' }
            : vue === 'relances'
              ? { population: 'all', work: 'followup' }
              : undefined;
  const [selectedId, setSelectedId] = useState<string | null>(linked);
  /**
   * The contact the drawer HOLDS, which outlives the one it shows.
   *
   * Closing sets `selectedId` to null and leaves this alone, so the drawer
   * slides out carrying the file that was being read rather than an empty box,
   * and a re-open of the same contact costs no remount. Never cleared: an
   * inert, off-screen subtree is not worth a second state transition.
   */
  const [shownId, setShownId] = useState<string | null>(linked);
  /** The row that opened the drawer, so focus can be handed back to it. */
  const trigger = useRef<HTMLElement | null>(null);
  /**
   * The badges cleared optimistically this session, held as readMark() rather
   * than as bare ids so a newer message lifts the mask on its own.
   *
   * A thread arrived at by link counts as read exactly like one arrived at by
   * click, and that is seeded HERE rather than derived in the projection below.
   * Derived, it was a mask no message could ever lift: the deep-linked contact
   * rendered as read for the whole session whatever arrived afterwards. Seeded
   * as an initial value, server and browser compute it from the same props on
   * the same first render, so nothing flashes and nothing mismatches — and the
   * mark expires like every other.
   */
  const [readLocal, setReadLocal] = useState<Set<string>>(() => {
    const c = contacts.find((x) => x.id === linked);
    return new Set(c ? [readMark(c)] : []);
  });
  // Owned here rather than in the sheets: opening one decides how much scroll
  // room the thread has to hand back, and the thread has to be re-anchored on
  // its newest message afterwards, which only an effect that depends on this
  // can do.
  const [composerOpen, setComposerOpen] = useState(false);
  /**
   * Whether the sheet on screen holds text that is neither saved nor sent.
   *
   * A ref and not state: nothing renders from it, and the one place it is read
   * is the guard below, at the instant of the click. The sheets report it; see
   * `onDirtyChange` in reply-sheet.tsx and outbound-sheet.tsx.
   */
  const composerDirty = useRef(false);
  const onDirtyChange = useCallback((d: boolean) => {
    composerDirty.current = d;
  }, []);

  // Same behaviour as the workspace this replaces: opening a thread clears its
  // badge at once, locally, and tells the API in the background. A failed call
  // is swallowed: the badge comes back on the next load, which is the harmless
  // outcome, whereas blocking the click on a network round trip is not.
  function open(id: string, from?: HTMLElement | null) {
    /**
     * The one destructive path on this page, and the only one that asks.
     *
     * The sheets are keyed on the contact, deliberately: text written for one
     * contact must never follow the operator to the next and be sent to them.
     * The cost of that key is that a change of contact REMOUNTS the sheet and
     * the typing goes with it — and the drawer leaves every row behind it live
     * on purpose, so the gesture that destroys a half-written mail is a single
     * stray click on a full-width table. Closing is safe (the drawer keeps the
     * contact it holds and the text with it), so this is the only place the
     * question belongs.
     */
    if (
      id !== shownId &&
      composerDirty.current &&
      !window.confirm(
        'Un message est en cours et n’a pas été envoyé. Changer de fiche va le perdre. Continuer ?',
      )
    ) {
      return;
    }
    setSelectedId(id);
    setShownId(id);
    trigger.current = from ?? null;
    // Opening a contact is a reading act. The composer comes back to rest.
    setComposerOpen(false);
    const c = contacts.find((x) => x.id === id);
    const mark = c ? readMark(c) : '';
    if (c?.unread && !readLocal.has(mark) && c.email) {
      setReadLocal((prev) => new Set(prev).add(mark));
      void fetch('/api/crm/thread-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: c.email }),
      }).catch(() => {});
    }
  }

  /**
   * Closing hands the keyboard back where it came from — but only when the
   * operator asked to LEAVE the drawer.
   *
   * Escape and ✕ are that ask: without the hand-back the caret lands on `body`
   * and the next Tab restarts at the top of the dashboard, which on a
   * two-hundred-row table means finding the row again by eye. The rAF is what
   * puts it after the paint that makes the drawer inert, or the browser moves
   * focus out of it on its own and undoes this.
   *
   * A pointerdown OUTSIDE is not that ask. It has already named the next focus
   * target — the search field, a tile, a chip — and the browser focuses it in
   * the same task; a rAF firing afterwards took the caret out of the field the
   * operator had just clicked, so the typing went to a row button and Espace
   * re-opened the fiche. On that path focus stays wherever the click put it,
   * which for a non-focusable target is `body`: the accepted cost of honouring
   * a designation instead of overriding it.
   */
  const close = useCallback((reason: CloseReason) => {
    setSelectedId(null);
    if (reason === 'outside') return;
    requestAnimationFrame(() => trigger.current?.focus());
  }, []);

  // Memoised: the projection clones every contact read this session, so
  // without the memo each render of this component would hand the tree below
  // fresh objects to reconcile. The table's search costs nothing here either
  // way: its state lives in ContactTable, so typing re-renders the table alone.
  //
  // Clearing unread also re-ranks the row: "À répondre" sorts unread first
  // (mail-rows.ts), so a thread opened yields the top of that filter the moment
  // it opens. Intended, and the deep-linked thread rides the same road: it is
  // seeded into readLocal above rather than special-cased here, which is what
  // gives it the same expiry as every other mark.
  //
  // Matched on readMark and not on the id: the mask must not outlive the
  // mutation it mirrors. A contact read earlier whose thread has since received
  // a new inbound carries a new mark, misses the set, and comes back unread —
  // dot, weight and unread-first rank — instead of staying silently masked
  // until a full page load.
  const view = useMemo(
    () => contacts.map((c) => (readLocal.has(readMark(c)) ? { ...c, unread: false } : c)),
    [contacts, readLocal],
  );

  // Memoised too, and not merely tidy. The table memoises its projection on
  // this object's identity, and the projection sorts the base, scores heat and
  // folds a search haystack per contact. Built inline at the call site it would
  // be a new object on every keystroke, every hover-driven busy flip and every
  // open — which is exactly the two-hundred-row rebuild the memo down there
  // exists to prevent.
  const input = useMemo(
    () => ({ contacts: view, situations, snoozed, woke }),
    [view, situations, snoozed, woke],
  );

  /**
   * What the drawer draws: the contact it HOLDS, not the one that is selected.
   * The two differ for exactly as long as the closing slide lasts, which is
   * what keeps an empty box from sliding out.
   */
  const shown = view.find((c) => c.id === shownId) ?? null;
  /** Whether it is out. The one thing read from `selectedId` down here. */
  const drawerOpen = selectedId !== null && shown !== null;
  const situation = shown ? situations[shown.id] : undefined;
  /**
   * Which of the two writing paths this contact is on. Read once here and
   * nowhere else in this tree: the sheet that is rendered and the room the
   * thread reserves for it have to agree, and two readings are two answers
   * waiting to disagree.
   *
   * The kind is handed over as well as the situation, and it is what keeps an
   * institution off the prospecting sheet even before its first letter: see
   * intent.ts. OutboundSheet asks for an angle and offers a pre-written pitch,
   * which is not a thing to put in front of somebody about to write to a
   * financial supervisor.
   */
  const intent = intentOf(situation, shown?.kind);

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
  const tailCount = (shown?.messages.length ?? 0) + (shown?.draft ? 1 : 0);
  // `selectedId` as well as `shownId`: re-opening the SAME contact leaves the
  // held file untouched, and the newest message still has to be back in view.
  useEffect(() => {
    const el = scroller.current;
    if (el && tailCount > 0) el.scrollTop = el.scrollHeight;
  }, [selectedId, shownId, tailCount, composerOpen]);

  return (
    <div className="min-w-0">
      {/* The whole page, from the first paint. There is no longer a state in
          which three quarters of the screen say "Sélectionne un contact": the
          table IS the screen, and the detail comes to it. */}
      <ContactTable
        input={input}
        selectedId={selectedId}
        onSelect={open}
        initialSelection={initialSelection}
      />

      {/* Everything that used to fill the right-hand pane, unchanged and in the
          same order, now inside a drawer. The drawer holds the positioning and
          the p-4 the writing sheets count on — see contact-drawer.tsx. */}
      <ContactDrawer
        open={drawerOpen}
        label={shown ? `Fiche de ${shown.company || shown.email}` : 'Fiche contact'}
        onClose={close}
      >
        {shown && (
          <>
            {/* Pinned: who this is, and what to do about them. Everything else
                scrolls. It is a tall thing to pin, and it is what made the
                writing surface float: measured with this header pinned, its
                370px against a 265px composer that sat in the flow left the
                thread 0px inside the panel, on the most ordinary window there
                is. The banner in particular has to stay: its job is to answer
                "what next" at the moment the operator decides what to write.

                pr-9 because the drawer's close control is pinned to that
                corner rather than costing a row of its own. */}
            <div className="pr-9">
              <ContactIdentity contact={shown} />
            </div>
            {/* The band, and inside it the one gesture that answers the line it
                draws. Pinned with the band on purpose: the control shipped a
                day earlier at the bottom of ContactDetail, in the scrolling
                region, and the operator reported he still could not classify a
                thank-you. Nothing was broken — he simply never scrolled to it,
                and the question is asked up here.

                The fallback exists because losing the gesture entirely is the
                failure being fixed: a contact with no situation cannot happen
                (the page builds one per id) and the drawer would still open, so
                the branch that costs one line is the branch that keeps the
                button reachable if that ever stops being true. */}
            <div className="mt-3">
              {situation ? (
                <SituationBand
                  situation={situation}
                  kind={shown.kind}
                  noReply={noReplyHolds(shown, situation)}
                  action={<NoReplyControl contact={shown} />}
                />
              ) : (
                <NoReplyControl contact={shown} />
              )}
            </div>
            {/* Pinned with the band, not scrolled with the thread: the whole
                point is to spare the re-read, so it must be visible before
                any scrolling happens. Only earns its pixels on real threads. */}
            {/* Prefixed keys, deliberately: these three siblings each remount
                on contact change via the id, but React requires keys to be
                unique AMONG siblings. Three brothers sharing `shown.id`
                broke reconciliation and stacked zombie summary cards, one per
                contact switch, each frozen on the previous thread's text. */}
            {shown.messages.length >= 4 && shown.email && (
              <ThreadSummary
                key={`summary-${shown.id}`}
                email={shown.email}
                company={shown.company}
                messages={shown.messages}
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
              // overscroll-contain: the drawer floats over a table that scrolls
              // too, and reaching the end of a thread must not carry on
              // scrolling the two hundred rows behind it.
              className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1"
            >
              <ContactDetail contact={shown} situation={situation} woke={woke[shown.id]} />
              <Thread
                messages={shown.messages}
                // Without this the contact's bubbles are labelled 'lui'. An
                // address-less prospect has neither, so the fallback stands.
                counterpartLabel={shown.company || shown.email || undefined}
                draftSlot={
                  shown.draft ? (
                    // Keyed on the draft's content, not only on the contact.
                    // DraftCard seeds its editable text from props on mount, so
                    // an unkeyed card would keep the previous contact's text
                    // after a selection change, and stale text after the
                    // composer overwrote the draft. Both would offer a send
                    // button on something the operator is not reading.
                    <DraftCard
                      key={draftKey(shown.id, shown.draft)}
                      contact={shown}
                      draft={shown.draft}
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
                contact and be sent to them. That key destroys the typing, so
                the sheets report whether there is any (`onDirtyChange`) and
                `open()` asks before the switch — the guard, not a second copy
                of the text.

                Two paths and not one. Answering somebody who wrote to us has
                nothing to choose and nothing to prospect, so it gets a short
                sheet and the two checks that still apply. A mail nobody asked
                for gets the angles, the pre-written mail, the draft and the
                whole rule set. Both float over the drawer; only the height
                they cover differs. */}
            {intent === 'reply' ? (
              <ReplySheet
                key={`reply-${shown.id}`}
                contact={shown}
                situation={situation}
                // The page's count, forwarded untouched: the guardrail that caps
                // the day reads it, and nothing below this line builds a Date.
                sentToday={sentToday}
                open={composerOpen}
                onOpenChange={setComposerOpen}
                onDirtyChange={onDirtyChange}
              />
            ) : (
              <OutboundSheet
                key={`outbound-${shown.id}`}
                contact={shown}
                situation={situation}
                sentToday={sentToday}
                open={composerOpen}
                onOpenChange={setComposerOpen}
                onDirtyChange={onDirtyChange}
              />
            )}
          </>
        )}
      </ContactDrawer>
    </div>
  );
}
