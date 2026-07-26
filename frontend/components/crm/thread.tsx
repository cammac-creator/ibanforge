'use client';

import { useState, type ReactNode } from 'react';
import { splitQuoted } from '@/lib/crm/quoted';
import type { Message } from '@/lib/crm/types';

const LANG_LABEL: Record<string, string> = {
  fr: 'français',
  en: 'anglais',
  de: 'allemand',
  it: 'italien',
  es: 'espagnol',
  pt: 'portugais',
  nl: 'néerlandais',
  zh: 'chinois',
  ru: 'russe',
  ar: 'arabe',
  ja: 'japonais',
  pl: 'polonais',
  sv: 'suédois',
  da: 'danois',
  no: 'norvégien',
  fi: 'finnois',
  tr: 'turc',
  el: 'grec',
  he: 'hébreu',
  cs: 'tchèque',
  uk: 'ukrainien',
  ro: 'roumain',
  hu: 'hongrois',
};

/**
 * Render a stored msg_date without ever constructing a Date.
 *
 * These bubbles are prerendered on the server and then hydrated in the browser.
 * Stored stamps look like 'YYYY-MM-DDTHH:MM' and carry no timezone, so
 * `new Date(...)` reads them as *local* time and would yield a different string
 * on a UTC server than in a Europe/Zurich browser: a hydration mismatch. Plain
 * string work gives the same answer in both places.
 *
 * The column is free text (clipped to 40 chars server-side), so anything that
 * does not match the expected shape falls back to the raw value rather than
 * disappearing. The year is dropped for density, exactly as the mockup does;
 * the full stamp stays reachable through the title attribute.
 */
function formatStamp(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(raw);
  if (!m) return raw;
  const [, , month, day, hour, minute] = m;
  return hour ? `${day}/${month} ${hour}:${minute}` : `${day}/${month}`;
}

function Bubble({ m, counterpartLabel }: { m: Message; counterpartLabel?: string }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  // Anything not inbound is ours. ContactBase.messages is documented never to
  // carry drafts, but should one ever leak in, putting it on the operator's
  // side is the harmless failure; rendering it as the contact's own words,
  // which `=== 'out'` would do, is not.
  const mine = m.direction !== 'in';

  // Show a French translation by default for any non-French message, English
  // included. Guard against malformed lang values (a model echoing a
  // placeholder, or 'und').
  const validLang = !!(m.lang && /^[a-z]{2,3}$/.test(m.lang) && m.lang !== 'und');
  const hasFr = !!(validLang && m.lang !== 'fr' && m.snippet_fr);
  const source = hasFr && !showOriginal ? (m.snippet_fr ?? '') : m.body || m.snippet || '';
  const { fresh, quoted } = splitQuoted(source);

  // splitQuoted cuts at the first quote marker, so a '>' inside genuinely new
  // text folds real content away. The toggle therefore states how many lines
  // are hidden and is styled as a link, so nothing ever looks lost.
  const quotedLines = quoted ? quoted.split('\n').length : 0;
  const quotedLabel = quotedLines > 1 ? `les ${quotedLines} lignes citées` : 'la ligne citée';

  const stamp = formatStamp(m.msg_date);

  return (
    <div className={mine ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={[
          // wrap-anywhere is load-bearing, not cosmetic. Mail bodies carry long
          // unbroken tokens (tracking URLs, hashes) that whitespace-pre-wrap
          // will not break, and every flex item defaults to min-width:auto, so
          // such a token sets a min-content floor that propagates up through
          // the rows here to the page and scrolls the whole layout sideways.
          // break-words (overflow-wrap: break-word) is not enough: it breaks
          // the line but leaves the min-content contribution at full token
          // width. overflow-wrap: anywhere shrinks that contribution too, which
          // is what actually keeps the page from widening. min-w-0 lets the
          // bubble shrink; overflow-wrap inherits, so subject, body and quote
          // are all covered here.
          'min-w-0 max-w-[78%] rounded-xl px-3 py-2 text-xs leading-relaxed wrap-anywhere',
          mine
            ? 'rounded-br-sm bg-amber-500/15 text-amber-100'
            : 'rounded-bl-sm bg-blue-500/15 text-blue-100',
        ].join(' ')}
      >
        {/* --fg-3, not --fg-4: same ruled defect as the quote below. Measured
            on composited pixels, --fg-4 at 10px gives 4.28:1 on the blue tint
            and 3.94:1 on the amber, both under AA. This row carries the date
            and the 'date inconnue' fallback. */}
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-[var(--fg-3)]">
          <span className={mine ? 'text-amber-400' : 'text-blue-400'}>
            {mine ? 'toi' : (counterpartLabel ?? 'lui')}
          </span>
          {stamp ? (
            <span title={m.msg_date ?? undefined}>{stamp}</span>
          ) : (
            <span className="italic">date inconnue</span>
          )}
          {validLang && (
            <span
              className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[9px] text-violet-300"
              title={hasFr ? 'Traduit automatiquement en français' : 'Langue détectée du message'}
            >
              🌐 {(m.lang && LANG_LABEL[m.lang]) || m.lang}
              {hasFr && !showOriginal ? ' · traduit' : ''}
            </span>
          )}
        </div>
        {m.subject && <p className="mb-0.5 font-medium text-[var(--fg-1)]">{m.subject}</p>}
        {fresh && <p className="whitespace-pre-wrap">{fresh}</p>}
        {quoted && (
          <>
            <button
              type="button"
              onClick={() => setShowQuoted(!showQuoted)}
              aria-expanded={showQuoted}
              // --fg-3: this is an interactive control, and at --fg-4 it sat at
              // 3.94:1 on the amber tint, dimmer than the quote it reveals.
              className="mt-1.5 cursor-pointer text-[10px] text-[var(--fg-3)] underline underline-offset-2 hover:text-[var(--fg-2)]"
            >
              {showQuoted ? `▾ masquer ${quotedLabel}` : `▸ afficher ${quotedLabel}`}
            </button>
            {showQuoted && (
              // --fg-3, measured rather than picked by name. The bubble tint
              // sits between this text and the ink surface, so the token's
              // documented ratio does not apply: sampled from composited
              // pixels, --fg-5 gave 1.96:1 (blue) and 1.79:1 (amber), --fg-4
              // 3.98:1 and 3.64:1, both failing AA, while --fg-3 reaches
              // 5.90:1 and 5.40:1 and passes on both. At 10px there is no
              // large-text exemption. Revealed text has to be readable:
              // splitQuoted cuts at the first marker, so what is behind this
              // toggle can be genuinely new content. The quote stays visually
              // secondary through the left rule, the italics and the 10px size
              // rather than through contrast.
              <p className="mt-1 whitespace-pre-wrap border-l-2 border-[var(--ink-5)] pl-2 text-[10px] italic text-[var(--fg-3)]">
                {quoted}
              </p>
            )}
          </>
        )}
        {hasFr && (
          <button
            type="button"
            onClick={() => setShowOriginal(!showOriginal)}
            // No aria-expanded here: this swaps one rendering of the message for
            // another, it does not reveal a region. The label already says which
            // way it will go.
            className="mt-1 block cursor-pointer text-[10px] text-violet-400 underline underline-offset-2 hover:text-violet-300"
          >
            {showOriginal ? 'voir la traduction' : 'voir l’original'}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The thread as chat bubbles: the contact on the left in blue, the operator on
 * the right in amber, so the side the last message landed on says who has to
 * play next. `draftSlot` is the anchor Task 7b hangs the draft card on; it is a
 * plain node, so a Server Component can be passed straight through this client
 * boundary.
 */
export function Thread({
  messages,
  counterpartLabel,
  draftSlot,
}: {
  messages: Message[];
  /**
   * Shown on inbound bubbles in place of 'lui'. The caller holds the Contact;
   * this component does not, and Message carries no display name of its own
   * (counterparty is the sending mailbox, not the person).
   */
  counterpartLabel?: string;
  draftSlot?: ReactNode;
}) {
  if (messages.length === 0 && !draftSlot) {
    return (
      // --fg-4, not --fg-5: this is a full sentence the reader has to read, and
      // 14px is below the large-text threshold. On plain ink --fg-4 clears AA
      // (5.23:1 on ink-0, 5.03:1 on ink-1, 4.74:1 on ink-2) where --fg-5 reaches
      // only 2.33:1 to 2.57:1. No tint underneath here, so --fg-4 is enough and
      // going lighter would overstate a message that is only an empty state.
      <p className="py-6 text-center text-sm text-[var(--fg-4)]">
        Aucun échange pour l’instant. Le mail que tu envoies s’ajoute ici, et les réponses remontent
        automatiquement (synchro des boîtes toutes les 15 min).
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      {messages.map((m, i) => (
        <Bubble key={m.id ?? i} m={m} counterpartLabel={counterpartLabel} />
      ))}
      {draftSlot}
    </div>
  );
}
