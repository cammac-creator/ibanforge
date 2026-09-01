'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { confirmedSent, generatedDraft, readAnswer, reasonOf, withReason } from '@/lib/crm/api-result';
import { isAutomated } from '@/lib/crm/automated';
import { institutionalBrief } from '@/lib/crm/institutional-brief';
import { threadTail } from '@/lib/crm/thread-tail';
import type { Contact, Message, Situation } from '@/lib/crm/types';
import { GuardrailChecks, OverrideButton, useGuardrails } from './guardrails-ui';
import { PANEL_PADDING_PX } from './panel-padding';

/**
 * How tall the open sheet is, in pixels.
 *
 * Pinned rather than capped, and every pixel of it is taken off what the
 * operator can see of the conversation, which is why it is as short as a
 * subject line, four rows and a button row can honestly be. A pinned height
 * also means the sheet never grows over more of the thread when a translation
 * or a check appears: the inside scrolls instead.
 *
 * Re-posed when the CRM type scale was raised for readability (owner's call):
 * the body is `text-base leading-[22px] sm:text-sm` (the explicit line height is what keeps
 * this sum in integers), so four rows are 88 where they were 80, and the
 * subject went to text-sm, 30px against 26. 216 + 8 + 4 = 228.
 */
export const REPLY_SHEET_PX = 228;

/**
 * How much of the panel's scrolling region the sheet hides: its own height,
 * less the panel's bottom padding (PANEL_PADDING_PX), since the region stops
 * there and the sheet runs on to the panel's inner edge.
 *
 * Derived from the one number above rather than written a second time. The
 * panel reserves exactly this as scroll room, see crm-app.tsx, because the
 * panel scrolls the thread to its very end whenever the sheet opens and that
 * end would otherwise sit behind it. Exactly, and not generously: reserving
 * more scrolls a short thread off the top of the region, reserving less hides
 * the newest message, which is the whole thing this lot is about.
 */
export const REPLY_SHEET_COVER_PX = REPLY_SHEET_PX - PANEL_PADDING_PX;

/**
 * Who the answer is going to, in one word where there is one.
 *
 * A first name and not the full identity: this is the resting label of a bar
 * the operator reads all day, and a label that grows into a sentence stops
 * being read. Falls back to the company and then to the address, which is how
 * the rest of the CRM names a contact with no recorded name.
 */
function replyTarget(c: Contact): string {
  const name = c.sourcing?.contactName?.trim();
  if (name) return name.split(/\s+/)[0];
  return c.company || c.email;
}

/**
 * The subject an answer carries: theirs, prefixed once.
 *
 * Walked backwards rather than read off the last message, because the newest
 * one is not always the one with a subject, and an answer with no subject is
 * one /api/crm/send will not record into the timeline.
 *
 * Automated messages are skipped, for the same reason threadTail skips them
 * when it picks the mail to answer. An out-of-office or a support-desk
 * acknowledgement that landed after the human mail is the newest thing with a
 * subject, so without this term the field would open on "Re:" and the robot's
 * subject while the generation brief, which does skip them, worked from the
 * human mail. The two would be answering different mails on one screen.
 *
 * An existing prefix is left alone. "Re: Re: X" reads as a machine, and
 * repeat.ts already treats "Re: X" answering "X" as ordinary mail rather than
 * as a duplicate.
 */
function replySubject(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (isAutomated(messages[i])) continue;
    const s = messages[i].subject?.trim();
    if (!s) continue;
    return /^re\s*:/i.test(s) ? s : `Re: ${s}`;
  }
  return '';
}

/**
 * Answering somebody who wrote to us, and nothing else.
 *
 * The composer this splits away from walks the operator through an angle, a
 * generation and the whole prospecting rule set before a mail can leave. That
 * is the right road for a cold first touch and the wrong one for an answer:
 * the thread already says what to write about, and somebody who just wrote to
 * us has not asked to be prospected. So there is no angle here, no pre-written
 * mail, no mode to choose, and the checks run with `intent: 'reply'`, which
 * leaves only the em dash and the empty body armed.
 *
 * The second half of why this exists is the geometry. The old composer sat in
 * the flow at the foot of the panel and took its height out of the thread:
 * measured on an ordinary window, a 370px pinned header plus a 265px open
 * composer inside a 76vh panel left the conversation exactly zero pixels. This
 * one floats over the foot of the panel instead, and the panel hands back the
 * room it covers as scroll space, so the newest messages stay readable while
 * the answer is typed.
 *
 * The caller must key this on the contact id and must make the panel a
 * positioned ancestor (crm-app does both). Without the key, text typed for one
 * contact would still be in the sheet after the operator selects another, and
 * the next click on Envoyer would send it to them.
 */
export function ReplySheet({
  contact: c,
  situation: s,
  sentToday,
  open,
  onOpenChange,
  onDirtyChange,
}: {
  contact: Contact;
  /**
   * Undefined never arrives from the only caller: crm-app renders this sheet
   * only when the situation says the ball is ours, so an absent one routes to
   * the other sheet before reaching this prop. If one ever did arrive,
   * useGuardrails would derive 'outbound' and arm the whole prospecting rule
   * set inside a reply sheet: the stricter failure, not a warmer one.
   */
  situation?: Situation;
  /**
   * Real outbound mails dated today, counted by the page against one clock and
   * handed down untouched. Never recomputed here: msg_date carries no timezone
   * and this subtree is server-rendered before it is hydrated.
   */
  sentToday: number;
  /**
   * Folded or unfolded. Held by the panel rather than here, because the panel
   * has to reserve the room this sheet covers, and it can only do that while it
   * knows the sheet is up.
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Whether there is an answer being written that has not been sent.
   *
   * The caller keys this sheet on the contact, so a change of contact destroys
   * whatever is in it; this is what lets the caller ask first. A boolean and
   * nothing more: the text stays here, and no draft is persisted per contact.
   */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  /**
   * Prefilled, unlike the body, and editable rather than derived silently.
   *
   * Editable because the em dash check spans both fields and the subject of an
   * answer is the recipient's own subject line: a dash they wrote would block
   * the send on a body that is perfectly clean, with nothing on screen to fix.
   * The way out of that has to be a keystroke, not the override, which is for a
   * rule the operator decides to ignore rather than for one they cannot reach.
   */
  const [subject, setSubject] = useState(() => replySubject(c.messages));
  const [body, setBody] = useState('');
  const [fr, setFr] = useState<string | null>(null);
  const [busy, setBusy] = useState<false | 'gen' | 'send'>(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  /**
   * The work-height mode, same contract as the outbound sheet's: expanded, the
   * sheet stands at min(85%, 720px) of the panel and the answer grows from
   * four rows to fourteen. The scroll reserve stays blind to it — it protects
   * a reading nobody is doing while they are writing.
   */
  const [expanded, setExpanded] = useState(false);

  const filled = !!subject.trim() && !!body.trim();

  /**
   * Told upwards, so the caller can ask before a change of contact throws it
   * away. The body alone, exactly as the folded bar reads it: the subject is
   * prefilled by construction and says nothing about work in progress.
   */
  const dirty = !!body.trim();
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  // Separate from the report above, and cleanup-only: folded into that effect,
  // the cleanup would flip the flag false and true again on every keystroke,
  // and any read landing between the two would see a clean sheet.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  /**
   * Could this be sent at all, the checks aside. None of the checks asks
   * whether anything was written by the operator rather than by the prefill,
   * and a subject on its own is not an answer.
   */
  const sendable = !!c.email && filled && busy === false;
  // `situation` and not an intent: useGuardrails derives the intent itself, so
  // the app reads it in one place and has no second answer to drift.
  const g = useGuardrails({
    subject,
    body,
    sentToday,
    situation: s,
    messages: c.messages,
    sendable,
    kind: c.kind,
  });
  const canSend = sendable && !g.blocked;

  /**
   * The checks, minus the one that is true of every sheet that has just opened.
   *
   * `empty_body` still blocks and still counts in `g.blocked`: the report is
   * untouched and the send is off exactly as before. What goes is the red line
   * saying "Le message est vide." to somebody who has not typed a character
   * yet, which is scolding a normal state. The greyed Envoyer is the whole
   * explanation an empty field needs.
   */
  const shown = g.report.issues.filter((i) => i.code !== 'empty_body');
  // Unique per surface, and distinct from the composer's and the draft card's:
  // two lists sharing an id would point every aria-describedby at the first.
  const checksId = 'reply-checks';

  /**
   * Ask before a proposal replaces text the operator typed.
   *
   * Silent when there is nothing to lose, and when what is coming is what is
   * already there, which is the double click case.
   */
  function confirmReplace(next: string): boolean {
    const current = body.trim();
    if (!current || current === next.trim()) return true;
    return window.confirm('Une réponse est en cours. La proposition va la remplacer. Continuer ?');
  }

  /**
   * What the generator is told, and it is short on purpose: the thread is the
   * brief. Nothing here describes a pitch, a segment or a buying signal,
   * because none of that is what somebody waiting on an answer is owed.
   *
   * What a draft must never write is not decided here. Those rules are keyed on
   * the recipient's domain and are appended to `context` server side, by
   * /api/crm/generate-draft. See lib/crm/redaction-rules.ts.
   */
  function brief(): string {
    if (c.kind === 'institution') return institutionalBrief(c);
    return [
      `Contact: ${c.company || c.email}`,
      c.sourcing?.whatTheyDo ? `What they do: ${c.sourcing.whatTheyDo}` : '',
      'They wrote last and are waiting on you. Answer every question their mail asks, each one explicitly, before anything else. Do not open on a new pitch.',
      `Thread so far:\n${threadTail(c.messages)}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  async function propose() {
    setBusy('gen');
    setMsg(null);
    try {
      const r = await fetch('/api/crm/generate-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: c.account,
          to: c.email,
          // A hint only, and the answer's own subject: the thread stays one
          // thread in the recipient's mailbox.
          subject: subject.trim() || c.messages.at(-1)?.subject || 'IBANforge',
          context: brief(),
          // What the recipient IS, so the server can ground the mail in the
          // right facts. The usage enrichment behind /api/crm/generate-draft is
          // keyed on an API key: an institution holds none, so without this
          // flag the whole enrichment returns the body untouched and the letter
          // is written knowing nothing about IBANforge at all. The identity
          // block that replaces it lives server-side, in one place, for the
          // same reason the redaction rules do.
          ...(c.kind === 'institution'
            ? {
                contact_kind: 'institution' as const,
                institution: {
                  org: c.institution.org,
                  category: c.institution.category,
                  country: c.institution.country,
                  dossier: c.institution.dossier,
                },
              }
            : {}),
          // Not a follow-up. That mode asks for two or three sentences carrying
          // one new angle and no recap, which is the discipline of a mail
          // nobody asked for, and the opposite of answering questions.
          follow_up: false,
          // deposit:false. Nothing is written to the mailbox's Drafts folder: a
          // draft the CRM cannot see is one the operator leaves the app to
          // send, and that send never passes through recordSent().
          deposit: false,
        }),
      });
      const a = await readAnswer(r);
      const gen = generatedDraft(a);
      if (!gen) {
        setMsg({ text: withReason('Échec de la proposition', reasonOf(a)), bad: true });
        return;
      }
      // Asked after the call, so the question is skipped when the proposal says
      // what is already written, and is never asked for nothing.
      if (!confirmReplace(gen.emailEn)) {
        setMsg({ text: 'Proposition abandonnée, ton texte est intact.', bad: false });
        return;
      }
      // The body only. `gen.subject` is dropped on purpose: an answer keeps the
      // subject of the thread it answers, and a fresh subject line would break
      // that thread in the recipient's mailbox.
      setBody(gen.emailEn);
      setFr(gen.translationFr);
      g.clear();
      setMsg({ text: '✍️ Proposition écrite, rien n’est parti. Relis avant d’envoyer.', bad: false });
    } catch {
      setMsg({ text: 'Erreur réseau, rien n’a été proposé.', bad: true });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Both halves of a send failure in one sentence, in the words the two other
   * send surfaces use. The mail may have gone out on a call that reports a
   * failure, and it is precisely that mail the thread will not show, since
   * /api/crm/send records into the timeline only on a confirmed send.
   */
  function sendFailed(reason: string | null) {
    setMsg({
      text: `${withReason('Échec de l’envoi', reason)} Avant de renvoyer, vérifie le fil ET les messages envoyés de la boîte : le mail a pu partir quand même.`,
      bad: true,
    });
  }

  async function send() {
    setBusy('send');
    setMsg(null);
    try {
      const r = await fetch('/api/crm/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // intent and override are read by /api/crm/send, which replays the
        // blocking rules server-side (audit TABS-03, 2026-09-01). Declared
        // rather than guessed there: the route holds neither the thread nor
        // the grant the operator gave.
        body: JSON.stringify({ account: c.account, to: c.email, subject, body, intent: g.intent, override: g.forcedCodes }),
      });
      const a = await readAnswer(r);
      if (!confirmedSent(a)) {
        // Nothing is cleared on this road. The text stays where it is: the
        // operator may have to send it again and this is the only copy.
        sendFailed(reasonOf(a));
        return;
      }
      // Emptied at once, which also disables Envoyer: router.refresh() is not
      // awaitable, so this is what stands between a second click and a
      // duplicate mail.
      setBody('');
      setFr(null);
      // The subject survives, alone among the state: it is the thread's own
      // subject, so it is still the right one for the next answer in the same
      // thread, and this component is keyed on the contact rather than on the
      // messages, so nothing would ever prefill it a second time.
      //
      // The override dies with the mail it covered. Left armed it would cover
      // the next answer written to this contact.
      g.clear();
      // Folded back so the thread, where the mail has just appeared, is what
      // the operator sees next.
      onOpenChange(false);
      setMsg({ text: '✅ Envoyé, ajouté au fil.', bad: false });
      router.refresh();
    } catch {
      sendFailed('Erreur réseau');
    } finally {
      setBusy(false);
    }
  }

  /**
   * A first written request to an institution is not a reply, and the sheet
   * says so in every place it names what is being written.
   *
   * Words only: same sheet, same checks, same send path. "Répondre à" printed
   * over an empty thread reads as a tool that has lost the conversation rather
   * than as one that knows there is none, and this is the one contact kind that
   * reaches this sheet with nothing above it.
   */
  const firstLetter = c.kind === 'institution' && c.messages.length === 0;
  const target = replyTarget(c);
  const who = c.company || c.email;

  /**
   * Said wherever the send button is, folded or not: red alone tells a
   * colour-blind operator nothing about a send that is about to ignore a rule.
   *
   * Held here rather than handed to GuardrailChecks, which is the other two
   * surfaces' way of showing it, for two reasons of this one. The folded bar
   * has a send button and no check list, so the note would have nowhere to
   * appear; and the check list here sits in the part of the sheet that scrolls,
   * so a note inside it could be out of view while the armed button is not.
   */
  const forcedNote = g.forcedNote && (
    <p className="mt-2 shrink-0 text-[12px] font-medium leading-snug text-red-300">⚠️ {g.forcedNote}</p>
  );
  const note = msg && (
    <p
      role={msg.bad ? 'alert' : 'status'}
      className={`mt-2 shrink-0 text-[12px] ${msg.bad ? 'text-red-400' : 'text-[var(--fg-2)]'}`}
    >
      {msg.text}
    </p>
  );

  if (!c.email) {
    // Not a second copy of the header's sentence, which already says the
    // address is missing. This one says what it costs here: there is nothing to
    // answer into, and no button to press.
    return (
      <p className="mt-3 shrink-0 border-t border-[var(--ink-4)]/60 pt-3 text-[12px] text-amber-300">
        Réponse impossible tant que l’adresse n’est pas vérifiée.
      </p>
    );
  }

  if (!open) {
    return (
      // In the flow, and the only room this component ever takes from the
      // thread. Opening the sheet takes none: it floats over the panel.
      <div className="mt-3 shrink-0 border-t border-[var(--ink-4)]/60 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(true)}
            // aria-expanded only: the sheet it would control is not in the DOM
            // in this state, and aria-controls pointing at an absent id is an
            // invalid reference rather than a hint.
            aria-expanded={false}
            className="min-w-0 flex-1 truncate rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)] px-3 py-1.5 text-left text-[13px] text-[var(--fg-3)] hover:border-amber-500/40 hover:text-[var(--fg-2)]"
          >
            {/* Folded text is not lost text: say it is there and unsent. The
                subject is prefilled by construction, so it says nothing about
                whether there is work in progress. Only the body does. */}
            {body.trim()
              ? firstLetter
                ? '✏️ Demande en cours, pas encore envoyée'
                : '✏️ Réponse en cours, pas encore envoyée'
              : firstLetter
                ? `Écrire à ${target}`
                : `Répondre à ${target}`}
          </button>
          {/* The real send, and off at rest, since an empty body blocks. Off as
              well while a check stands: what the check says is one click away,
              in the sheet, rather than in a bar whose whole point is to be one
              line. Red when a grant is standing, exactly as in the sheet, with
              the same sentence under it. */}
          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            className={`shrink-0 rounded-lg border px-4 py-1.5 text-[13px] font-semibold disabled:opacity-50 ${
              g.forced
                ? 'border-red-500/60 text-red-300 hover:bg-red-500/15'
                : 'border-green-600/50 text-green-400 hover:bg-green-600/15'
            }`}
          >
            {busy === 'send' ? '… envoi' : 'Envoyer'}
          </button>
        </div>
        {forcedNote}
        {note}
      </div>
    );
  }

  return (
    // Over the foot of the drawer, not inside its column: the thread above
    // keeps every pixel it had, and the drawer gives back the room this covers
    // as scroll space. See REPLY_SHEET_COVER_PX.
    //
    // Absolute at every width, where this used to be viewport-fixed below lg.
    // Fixed was right while the thread WAS the small screen; the drawer is 640px
    // wide from the sm breakpoint up, and a viewport-wide bar under a 640px
    // drawer hangs out of it on every window between sm and lg.
    //
    // A column of three: what is being answered, then the answer, then the
    // buttons. Only the middle scrolls, so a translation or a check can never
    // push Envoyer out of reach, which is what a height cap did to the composer
    // this replaces.
    <div
      id="reply-sheet"
      style={{ height: expanded ? 'min(85%, 720px)' : REPLY_SHEET_PX }}
      className="absolute inset-x-0 bottom-0 z-10 flex flex-col border-t border-[var(--ink-4)] bg-[var(--ink-2)] p-3 shadow-[0_-10px_24px_-8px_rgba(0,0,0,0.65)]"
    >
      <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[12px] text-[var(--fg-3)]">
          {firstLetter ? 'Première demande à' : 'Réponse à'} {who}, depuis {c.account}
        </span>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-pressed={expanded}
            className="cursor-pointer text-[12px] text-[var(--fg-3)] underline underline-offset-2 hover:text-[var(--fg-1)]"
          >
            {expanded ? '⤡ réduire' : '⤢ agrandir'}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-expanded
            aria-controls="reply-sheet"
            className="cursor-pointer text-[12px] text-[var(--fg-3)] underline underline-offset-2 hover:text-[var(--fg-1)]"
          >
            replier
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Objet"
          aria-label={firstLetter ? 'Objet de la demande' : 'Objet de la réponse'}
          className="mb-2 w-full min-w-0 rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)] px-3 py-1 text-base text-[var(--fg-1)] focus:border-amber-500/40 focus:outline-none sm:text-sm"
        />
        {/* Empty on mount, and focused: nothing steals focus from a page being
            read, since this node does not exist until Répondre is clicked.
            min-w-0 is load-bearing, `cols` gives a textarea an intrinsic
            minimum width that w-full does not remove, and that minimum would
            set a floor the panel cannot absorb on a narrow window. */}
        <textarea
          autoFocus
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={expanded ? 14 : 4}
          placeholder={firstLetter ? 'Écris ta demande.' : 'Écris ta réponse.'}
          aria-label={firstLetter ? 'Corps de la demande' : 'Corps de la réponse'}
          className="w-full min-w-0 rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)] p-3 text-base leading-[22px] sm:text-sm text-[var(--fg-1)] focus:border-amber-500/40 focus:outline-none"
        />
        {fr && (
          /*
           * Open on arrival: the translation is what the owner reads to judge a
           * draft, so hiding it behind a click makes the reading step optional
           * on the one surface whose whole purpose is to be read before
           * sending.
           *
           * `key={fr}` because `open` is initial state only. Without it a
           * translation folded once stays folded through every later proposal,
           * since the node is never unmounted between two non-null values.
           */
          <details key={fr} open className="mt-1">
            <summary className="cursor-pointer text-[12px] text-blue-400">
              Traduction FR (pour toi seul, jamais envoyée)
            </summary>
            <p className="mt-1 whitespace-pre-wrap text-[12px] text-[var(--fg-3)] wrap-anywhere">{fr}</p>
          </details>
        )}
        {/* The report is handed over whole apart from its issue list: what is
            filtered is what is shown, never what blocks. */}
        <GuardrailChecks id={checksId} report={{ ...g.report, issues: shown }} subject={subject} body={body} />
      </div>
      <div className="mt-2 flex shrink-0 flex-wrap items-center gap-3">
        {/* Said in words rather than dressed as a button: generating is a tool
            an answer may reach for, and the corridor it used to be is the thing
            this sheet exists to remove. */}
        <button
          type="button"
          onClick={propose}
          disabled={busy !== false}
          className="text-[13px] text-[var(--fg-3)] underline underline-offset-2 hover:text-[var(--fg-1)] disabled:no-underline disabled:opacity-50"
        >
          {busy === 'gen' ? '… proposition' : 'Proposer un texte'}
        </button>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {/* Only ever offered against the em dash on this path: `empty_body` is
              the one other blocking rule a reply can raise, and it cannot stand
              at the same time as `sendable`, which the offer requires. */}
          {g.offer && <OverrideButton offer={g.offer} pressed={g.forced} onClick={g.toggle} dense />}
          <button
            type="button"
            onClick={send}
            // disabled, not aria-disabled. A focusable blocked button would put
            // the whole safety on one onClick guard.
            disabled={!canSend}
            // Gated on the displayed list and not on the report: `empty_body` is
            // counted and never shown, so a fresh sheet renders no list at all
            // and this would otherwise point at an id absent from the DOM.
            aria-describedby={shown.length > 0 ? checksId : undefined}
            className={`rounded-lg px-4 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50 ${
              g.forced ? 'bg-red-600 hover:bg-red-500' : 'bg-green-600 hover:bg-green-500'
            }`}
          >
            {/* The label never changes with the grant: a wider button is a
                button that moves, and this one sits beside a toggle the cursor
                has just clicked. */}
            {busy === 'send' ? '… envoi' : 'Envoyer'}
          </button>
        </div>
      </div>
      {forcedNote}
      {note}
    </div>
  );
}
