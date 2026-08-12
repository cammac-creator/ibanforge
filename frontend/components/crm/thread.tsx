'use client';

import { useState, type ReactNode } from 'react';
import { isAutomated } from '@/lib/crm/automated';
import { formatStamp } from '@/lib/crm/format';
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

function Bubble({ m, counterpartLabel }: { m: Message; counterpartLabel?: string }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  // Anything not inbound is ours. ContactBase.messages is documented never to
  // carry drafts, but should one ever leak in, putting it on the operator's
  // side is the harmless failure; rendering it as the contact's own words,
  // which `=== 'out'` would do, is not.
  const mine = m.direction !== 'in';

  // A desk robot, not a person. It stays in the thread, because hiding mail
  // that genuinely arrived would be its own kind of lie, but it is drawn in
  // neutral grey rather than the contact's blue and it says outright that it
  // does not count. situationOf ignores it, so the band above the thread and
  // this bubble agree without either consulting the other.
  const robot = isAutomated(m);

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
          'min-w-0 max-w-[78%] rounded-xl px-3 py-2 text-sm leading-relaxed wrap-anywhere',
          robot
            ? 'rounded-bl-sm bg-[var(--ink-3)] text-[var(--fg-2)]'
            : mine
              ? 'rounded-br-sm bg-amber-500/15 text-amber-100'
              : 'rounded-bl-sm bg-blue-500/15 text-blue-100',
        ].join(' ')}
      >
        {/* --fg-3, not --fg-4: same ruled defect as the quote below. Measured
            on composited pixels, --fg-4 at 10px gives 4.28:1 on the blue tint
            and 3.94:1 on the amber, both under AA. This row carries the date
            and the 'date inconnue' fallback. */}
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--fg-3)]">
          <span className={robot ? 'text-[var(--fg-3)]' : mine ? 'text-amber-400' : 'text-blue-400'}>
            {mine ? 'toi' : (counterpartLabel ?? 'lui')}
          </span>
          {robot && (
            <span
              className="rounded bg-[var(--ink-5)] px-1.5 py-0.5 text-[12px] font-medium text-[var(--fg-2)]"
              title="Accusé de réception, relance de guichet ou enquête de satisfaction. Ce message ne compte ni comme une réponse ni comme une balle dans ton camp."
            >
              ⚙ automatique · ne compte pas comme une réponse
            </span>
          )}
          {stamp ? (
            <span title={m.msg_date ?? undefined}>{stamp}</span>
          ) : (
            <span className="italic">date inconnue</span>
          )}
          {validLang && (
            <span
              className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[12px] text-violet-300"
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
              className="mt-1.5 cursor-pointer text-[12px] text-[var(--fg-3)] underline underline-offset-2 hover:text-[var(--fg-2)]"
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
              <p className="mt-1 whitespace-pre-wrap border-l-2 border-[var(--ink-5)] pl-2 text-[12px] italic text-[var(--fg-3)]">
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
            className="mt-1 block cursor-pointer text-[12px] text-violet-400 underline underline-offset-2 hover:text-violet-300"
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
/** "aujourd'hui", "hier", or "lundi 11 août" — the shelf between two days. */
function dayLabel(sqlDate: string | null | undefined): string | null {
  if (!sqlDate) return null;
  const d = new Date(sqlDate.includes('T') ? sqlDate : `${sqlDate.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const gap = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (gap === 0) return 'aujourd’hui';
  if (gap === 1) return 'hier';
  return d.toLocaleDateString('fr-CH', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Everything older than the last KEEP_RECENT messages folds behind one line. */
const KEEP_RECENT = 6;

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
      // --fg-3: a full sentence the reader has to read, at 14px, so no
      // large-text exemption. --fg-4 cleared AA on ink-0 to ink-2 but reached
      // only ~4.4:1 on ink-3, and globals.css defines --card as ink-3, so the
      // surface that fails is the default card rather than a hypothetical.
      // --fg-3 measures 6.6:1 there and stays plainly secondary at this size.
      <p className="py-6 text-center text-sm text-[var(--fg-3)]">
        Aucun échange pour l’instant. Le mail que tu envoies s’ajoute ici, et les réponses remontent
        automatiquement (synchro des boîtes toutes les 15 min).
      </p>
    );
  }
  return <ThreadBody messages={messages} counterpartLabel={counterpartLabel} draftSlot={draftSlot} />;
}

function ThreadBody({
  messages,
  counterpartLabel,
  draftSlot,
}: {
  messages: Message[];
  counterpartLabel?: string;
  draftSlot?: ReactNode;
}) {
  // Folded by default past KEEP_RECENT: reopening a long thread should cost a
  // glance. State lives here so switching contacts re-folds naturally (the
  // parent keys nothing on us, but messages.length changing resets nothing —
  // hence the explicit reset when the fold no longer applies).
  const [unfolded, setUnfolded] = useState(false);
  const foldable = messages.length > KEEP_RECENT + 2;
  const hidden = foldable && !unfolded ? messages.slice(0, messages.length - KEEP_RECENT) : [];
  const shown = foldable && !unfolded ? messages.slice(messages.length - KEEP_RECENT) : messages;

  let lastDay: string | null = null;
  const withSeparators: ReactNode[] = [];
  for (let i = 0; i < shown.length; i += 1) {
    const m = shown[i];
    const day = dayLabel(m.msg_date);
    if (day && day !== lastDay) {
      lastDay = day;
      withSeparators.push(
        <div key={`sep-${m.msg_date}-${i}`} className="flex items-center gap-3 py-0.5">
          <span className="h-px flex-1 bg-[var(--ink-4)]/60" />
          <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--fg-3)]">{day}</span>
          <span className="h-px flex-1 bg-[var(--ink-4)]/60" />
        </div>,
      );
    }
    withSeparators.push(<Bubble key={m.id ?? `m-${i}`} m={m} counterpartLabel={counterpartLabel} />);
  }

  return (
    <div className="flex flex-col gap-2.5">
      {hidden.length > 0 && (
        <button
          type="button"
          onClick={() => setUnfolded(true)}
          className="mx-auto rounded-full border border-[var(--ink-4)] px-3 py-1 text-[12px] text-[var(--fg-3)] hover:border-[var(--fg-3)] hover:text-[var(--fg-1)]"
        >
          ▸ {hidden.length} message{hidden.length > 1 ? 's' : ''} précédent{hidden.length > 1 ? 's' : ''}
          {(() => {
            const from = dayLabel(hidden[0]?.msg_date);
            const to = dayLabel(hidden.at(-1)?.msg_date);
            return from && to ? ` (${from} → ${to})` : '';
          })()}
        </button>
      )}
      {withSeparators}
      {draftSlot}
    </div>
  );
}
