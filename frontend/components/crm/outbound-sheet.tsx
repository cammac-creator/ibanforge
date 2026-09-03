'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  changedRows,
  confirmedSent,
  generatedDraft,
  proposedAngles,
  readAnswer,
  reasonOf,
  withReason,
  type ProposedAngle,
} from '@/lib/crm/api-result';
import { canLoadReadyMail } from '@/lib/crm/ready-mail';
import { nextActionLabel } from '@/lib/crm/situation';
import { threadTail } from '@/lib/crm/thread-tail';
import type { Contact, Situation } from '@/lib/crm/types';
import { GuardrailChecks, OverrideButton, useGuardrails } from './guardrails-ui';
import { PANEL_PADDING_PX } from './panel-padding';

/**
 * How tall the open sheet is, in pixels.
 *
 * The reply sheet's 228 plus two differences, not one. The body is the obvious
 * one: an answer is written in four rows and a mail nobody asked for has always
 * had six. Both textareas carry `text-base leading-[22px] sm:text-sm` since the CRM type
 * scale was raised — the explicit 22px line is what keeps two extra rows an
 * exact 44 with nothing for the browser to round, where the old 12px-at-1.625
 * rows needed a round-up note to avoid clipping the sixth row.
 *
 * The subject field is the second. It is `py-1.5 text-sm` here, inherited from
 * the dock this sheet grew out of, against `py-1 text-sm` on the reply side:
 * 6 + 20 + 6 plus two borders is 34px where the compact form is 4 + 20 + 4
 * plus two borders, 30px. Four pixels the reply base does not carry.
 *
 * 228 + 44 + 4 = 276.
 *
 * What this holds is the resting content: a subject line, six rows and the
 * button row. The translation and the check list are the scrolling content by
 * design, and the sheet holds still when they appear: the inside scrolls. The
 * angle panel is the one exception, ruled by the owner, and it grows the sheet
 * to OUTBOUND_SHEET_ANGLES_PX below for exactly as long as the choice is open.
 *
 * Pinned at all because of what the dock it replaces did in the flow. That dock
 * took its height out of the thread and needed two viewport height caps to stay
 * survivable: measured then, a 370px pinned header against a 265px open
 * composer left the conversation exactly zero pixels inside the 76vh panel, and
 * the angle panel on top of the dock took a 141px thread back to zero on a
 * window the first cap did not cover. A sheet that floats over the panel has
 * neither failure to prevent, so both caps are gone with the dock.
 */
export const OUTBOUND_SHEET_PX = 276;

/** Where this sheet remembers the height the operator last chose, as the reply sheet does. */
const EXPAND_KEY = 'ibf.crm.outboundSheetExpanded';

/**
 * How tall the sheet stands while the operator is choosing an angle.
 *
 * The choice panel is taller than the whole resting scroll region, so inside
 * a pinned 264 the third angle could only be reached by scrolling inside the
 * sheet, where the dock this replaces guaranteed the panel visible in one
 * block. The owner's ruling: the sheet grows for the duration of the angle
 * choice, then returns to 264.
 *
 * Sized to the chrome plus the panel, not to the resting height plus the
 * panel. The panel is the scrolling region's first child, so once the region
 * is as tall as the panel the guarantee is met, and the subject and the body
 * simply sit below the fold for the few seconds the choice is open. Nobody is
 * reading an empty textarea during that choice, and every pixel spent keeping
 * it on screen is a pixel of thread covered for nothing. An earlier version
 * added the panel's room to the whole resting 264 and reached 484, which
 * bought the resting region a second time and overtopped the pane on a short
 * window.
 *
 * The panel, term by term, at three angles (the most the upstream returns)
 * with one-line hints at this sheet's width:
 *
 *   1 border + 8 padding
 *   + 16.5 header line (text-[12px] on the p itself, so its own strut)
 *   + 6 header margin (mb-1.5)
 *   + 3 angle buttons at 55.75 each: 6 + 6 padding (py-1.5), 24 title line,
 *     2 hint margin (mt-0.5), 13.75 hint line (text-[12px] leading-snug
 *     1.375), 4 margin (mb-1), summing to 167.25
 *   + 26.5 footer row (1 + 1 border, 4 + 4 padding, one 16.5 line)
 *   + 8 padding + 1 border
 *   = 234.25 for the panel, plus its mb-2 of 8 = 242.25 of room.
 *
 * The title line is 24 and not 16.5, which is where the first version of this
 * sum went wrong by three struts: the `text-[12px]` sits on a span INSIDE the
 * button, while the line box cannot be shorter than the block's own strut, and
 * the button inherits 16px through the preflight's `font: inherit` with its
 * line-height of 1.5. No ancestor down to the button sets a font size.
 *
 * Chrome, term by term: 1 top border, 12 + 12 padding (p-3), 18 header line,
 * 6 header margin (mb-1.5), 8 + 30 for the pinned button row (mt-2), = 87.
 *
 * 87 + 249.375 = 336.375, rounded UP to 337 because rounding down is what
 * clips the third angle. A second hint line or a fourth angle would overflow
 * by its own height and scroll inside: the guarantee is sized to what the
 * upstream promises, not to what it might misbehave into.
 *
 * (All three lines above re-measured when the CRM type scale was raised:
 * the header and footer struts went from 16.5 to 18 with text-[12px], the
 * hint line from 13.75 to 15.125 with text-[11px].)
 */
export const OUTBOUND_SHEET_ANGLES_PX = 337;

/**
 * How much of the panel's scrolling region the sheet hides: its RESTING
 * height, less the panel's bottom padding (PANEL_PADDING_PX), since the
 * region stops there and the sheet runs on to the panel's inner edge.
 *
 * Derived from OUTBOUND_SHEET_PX rather than written a second time. The panel
 * reserves exactly this as scroll room, see crm-app.tsx, because it scrolls
 * the thread to its very end whenever the sheet opens and that end would
 * otherwise sit behind the sheet. Exactly, and not generously: reserving more
 * scrolls a short thread off the top of the region, reserving less hides the
 * newest message.
 *
 * Deliberately blind to OUTBOUND_SHEET_ANGLES_PX. While the angles are open
 * the sheet covers more of the thread and the reserve stays put: a reserve
 * that followed the growth would re-pad the region and shift the thread under
 * the operator's eyes mid-choice, to protect a reading nobody is doing in
 * those few seconds. The moment the choice resolves, the sheet is back at the
 * height this reserve is exact for.
 */
export const OUTBOUND_SHEET_COVER_PX = OUTBOUND_SHEET_PX - PANEL_PADDING_PX;

/**
 * The angle step, and its failure, in one value: on screen they are one moment,
 * a panel that opens under the operator's click and either offers the angles or
 * says why it cannot. Both states carry the same way out, which is what keeps
 * the promise that a follow-up can always be written, angles or no angles.
 *
 * `choose` never holds an empty list: nothing to choose between is a failure
 * with a different sentence, not a panel of no buttons.
 */
type AngleStep = { kind: 'choose'; angles: ProposedAngle[] } | { kind: 'failed'; reason: string };

/**
 * Writing to somebody who has not asked to hear from us, and every rule that
 * guards it.
 *
 * Three ways in, two ways out. The operator writes from scratch, loads the
 * prospect's pre-written mail, or asks for a generation, which on a follow-up
 * goes through a panel of angles first; then either sends, or parks the text as
 * a CRM-native draft that comes back as a card in the thread.
 *
 * The whole guardrail set is armed here, and that is the difference from the
 * reply sheet rather than anything on screen. `useGuardrails` derives the
 * intention from the situation it is handed, reading the same `ballInCourt`
 * that decided this component would be the one rendered, so the rules and the
 * routing cannot end up disagreeing about a contact.
 *
 * Nothing here writes to the mailbox's Drafts folder: every generation passes
 * `deposit: false`. That is the point of the flag. The IMAP deposit put the
 * draft somewhere the CRM cannot see, so the operator left the app to send it,
 * and that send never passed through recordSent(), which left a hole in the
 * timeline.
 *
 * The caller must key this on the contact id and must make the panel a
 * positioned ancestor (crm-app does both). The text below is local state;
 * without the key, selecting another contact would keep it, and the next click
 * on Envoyer would send one contact's mail to another.
 */
export function OutboundSheet({
  contact: c,
  situation: s,
  sentToday,
  open,
  onOpenChange,
  onDirtyChange,
}: {
  contact: Contact;
  /** Undefined only if the page failed to derive one; the goal line is dropped then. */
  situation?: Situation;
  /**
   * Real outbound mails dated today, counted by the page against one clock and
   * handed down untouched, exactly as `situation` is. Never recomputed here:
   * msg_date carries no timezone, so a UTC server and a browser in Zurich would
   * disagree on which day a late mail belongs to, and this subtree is
   * server-rendered before it is hydrated.
   */
  sentToday: number;
  /**
   * Folded or unfolded. Held by the panel rather than here, because the panel
   * has to reserve the room this sheet covers, and it can only do that while it
   * knows the sheet is up.
   *
   * That there is a folded state at all is not decoration. It is the "repos"
   * the plan named and the first code omitted: the form used to be always open,
   * and an always open writer is a reader who has nowhere to read. Folded, this
   * component is a 43px bar and the thread has the panel to itself.
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Whether there is a mail being written that has not been sent.
   *
   * The caller keys this sheet on the contact, so a change of contact destroys
   * whatever is in it; this is what lets the caller ask first. A boolean and
   * nothing more: the text stays here, and no draft is persisted per contact.
   */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [fr, setFr] = useState<string | null>(null);
  /**
   * The work-height mode, on the operator's demand ("trop petite pour
   * travailler agréablement", 28/08). Expanded, the sheet stands at
   * min(85%, 720px) of the panel and the body grows from six rows to sixteen.
   * The scroll reserve stays blind to it, exactly as it is to the angles
   * growth above: the reserve protects a reading nobody is doing while they
   * are writing, and the sheet is back at rest the moment it folds.
   */
  const [expanded, setExpanded] = useState(false);
  /**
   * The remembered choice, same contract and same reason as the reply sheet's
   * (03/09/2026): read in an effect, because this subtree is server-rendered
   * and a first state that differs between server and browser is a mismatch.
   */
  useEffect(() => {
    try {
      if (localStorage.getItem(EXPAND_KEY) === '1') setExpanded(true);
    } catch {
      // Private window, or storage refused: the default height stands.
    }
  }, []);

  function toggleExpanded() {
    setExpanded((e) => {
      const next = !e;
      try {
        localStorage.setItem(EXPAND_KEY, next ? '1' : '0');
      } catch {
        // Nothing to remember; the toggle still works for this sheet.
      }
      return next;
    });
  }

  /**
   * The body grows with its content, so this sheet has one scrollbar and not
   * two: a fixed row count scrolls inside a region that scrolls as well, and
   * reading a long mail through a six-line window is the complaint this
   * answers (owner, 03/09/2026).
   */
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [body, expanded, open]);
  const [busy, setBusy] = useState<false | 'gen' | 'send' | 'draft' | 'angles'>(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  /**
   * The angle panel, and null while there is none.
   *
   * Local, like the text, and therefore wiped when the caller remounts this on
   * a change of contact, which is the point of that key: an angle proposed for
   * one thread describes that thread and nothing else.
   */
  const [step, setStep] = useState<AngleStep | null>(null);

  /**
   * Put the scrolling region back to its top when the angles arrive.
   *
   * OUTBOUND_SHEET_ANGLES_PX makes the region exactly as tall as the panel, and
   * the panel is the region's first child, so the guarantee "visible in one
   * block" holds only from a scroll position of zero. The region can genuinely
   * be scrolled at that moment: the check list and the translation live in it,
   * and the button that asks for angles is pinned below it, so it stays
   * clickable while the region is scrolled down. Without this the operator
   * would ask for angles and get the panel's lower half.
   */
  const region = useRef<HTMLDivElement>(null);
  const choosing = step?.kind === 'choose';
  useEffect(() => {
    if (choosing) region.current?.scrollTo({ top: 0 });
  }, [choosing]);

  const filled = !!subject.trim() && !!body.trim();
  /**
   * Anything at all typed, which is not the same question as `filled`.
   *
   * `filled` gates the buttons and needs both fields, since neither a send nor
   * a save is possible without a subject. What the folded bar has to announce
   * is something else: that there is text behind the fold which is neither
   * saved nor sent. Reading `filled` there made the bar say "Écrire à ..." over
   * a body full of unsaved text whose subject happened to be empty, observed in
   * the harness, which is precisely the text the question below exists to
   * protect.
   */
  const hasText = !!subject.trim() || !!body.trim();

  /**
   * The same question, told upwards, so the caller can ask before a change of
   * contact throws the text away.
   *
   * `hasText` and not `filled`, for the reason above: a body with no subject is
   * still work in progress. It reads clean again the moment the text stops
   * being at risk: both roads out of this sheet — send() and saveDraft() —
   * empty the two fields on a confirmed success, so nothing is asked about a
   * mail that has already left or that is now sitting in the thread as a card.
   */
  useEffect(() => {
    onDirtyChange?.(hasText);
  }, [hasText, onDirtyChange]);
  // Separate from the report above, and cleanup-only: folded into that effect,
  // the cleanup would flip the flag false and true again on every keystroke,
  // and any read landing between the two would see a clean sheet.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  /**
   * Could this be sent at all, the checks aside. It is what stops a blank mail,
   * and it has to: none of the checks asks whether anything was written. Two of
   * them even fire on an untouched draft, the daily cap on the counter and the
   * missing opt-out on a cold first touch, so "no issue" never means "ready to
   * send" and "blocking" never means "there is text worth blocking".
   */
  const sendable = !!c.email && filled && busy === false;
  // `situation` and not an intent: useGuardrails derives the intent itself, so
  // the app reads it in one place and has no second answer to drift.
  // Passed for completeness rather than for effect: crm-app never routes an
  // institution here. Handing it over anyway means the day one does, the rules
  // follow the recipient instead of following which sheet happened to open.
  const g = useGuardrails({
    subject,
    body,
    sentToday,
    situation: s,
    messages: c.messages,
    sendable,
    kind: c.kind,
  });

  /**
   * Ask before replacing text the operator typed and has not saved anywhere.
   *
   * A stored draft already gets this question, and unsaved typing is the more
   * likely thing to lose: the folded bar says "message en cours, ni enregistré
   * ni envoyé" with Générer one click away in the same row. Same shape of
   * question as the overwrite one, deliberately, so there is one pattern here
   * and not two.
   *
   * Silent when there is nothing to lose, and when what is about to be written
   * is what is already there, which is the double-click case.
   */
  function confirmReplace(next: string, what: string): boolean {
    const current = body.trim();
    if (!current || current === next.trim()) return true;
    return window.confirm(
      `Un message est en cours dans le composeur. ${what} va le remplacer. Continuer ?`,
    );
  }

  /**
   * A prospect never contacted starts from its pre-written mail.
   *
   * The guard is the same rule the two buttons are rendered on, called here as
   * well and not only there: what it stops is loading the mail already sent
   * back into the composer, and a guard that lives only in the markup is one a
   * third caller can walk around without noticing there was a rule.
   */
  function loadReadyMail() {
    if (!canLoadReadyMail(c)) return;
    const useFr = c.readyMail.recommendedLang === 'fr';
    const nextSubject = (useFr ? c.readyMail.subjectFr : c.readyMail.subjectEn) ?? '';
    const nextBody = (useFr ? c.readyMail.bodyFr : c.readyMail.bodyEn) ?? '';
    // Declining says nothing: this is synchronous and the text visibly did not
    // move. The generation below is the opposite case and does say something.
    if (!confirmReplace(nextBody, 'Le mail pré-rédigé')) return;
    setSubject(nextSubject);
    setBody(nextBody);
    // The radar writes every ready mail in BOTH languages, and the French half
    // exists for exactly one reader: the operator. Loading the English mail
    // used to throw it away, which left the one screen built for judging a
    // draft without the text its judge actually reads. When the mail itself is
    // the French one there is nothing to translate.
    setFr(useFr ? null : (c.readyMail.bodyFr ?? null));
    setMsg(null);
    // An angle chosen for a mail that is no longer the one being written.
    setStep(null);
    // A whole pre-written mail plus its translation is a reading job, not a
    // glance: open the room it needs instead of making the operator ask.
    setExpanded(true);
    g.clear();
  }

  /**
   * A follow-up is due on this contact, which is the only situation where an
   * angle is asked for. The owner's rule for a follow-up is that it is short
   * and carries something new rather than restating the first mail, and that
   * rule is what the angle serves.
   */
  const isFollowup = s?.nextAction === 'followup';

  /**
   * What the generator is told: who this is, where the thread stands, and what
   * to aim for.
   *
   * What a draft must never write is not decided here. Those rules are keyed
   * on the recipient's domain, and both the domain and the protected name are
   * facts about the owner's relationships, so they are configuration on the
   * server: /api/crm/generate-draft appends them to this text before it goes
   * upstream. See lib/crm/redaction-rules.ts.
   *
   * Two of these lines are restored from the brief the Clients page built
   * before the refactor, kept in its own shape and wording rather than
   * reworded, because both were lost silently when that page went away and the
   * proxy forwards this text verbatim: there is no other place they could
   * live.
   *
   * The angle, when one was chosen, is another such line. It is internal: this
   * whole text steers the draft and none of it is ever sent.
   *
   * What is NOT here any more is the follow-up discipline. This text used to
   * carry "This is a FOLLOW-UP: at most 2 sentences, one new angle, no recap of
   * the previous mail." on the same `isFollowup`, and the `follow_up` flag now
   * carries all three of those clauses in the upstream system prompt. Two
   * reasons for deleting rather than keeping both. The instructions disagreed
   * on the number, at most two sentences here against two or three there, and a
   * user turn arguing with a system turn over a count is worse than no line at
   * all: the model has to pick, and it picked the system prompt. And the rule
   * belongs where it can be tuned without a frontend deploy. Nothing is lost by
   * the deletion because the same expression gates both: wherever this line
   * used to appear, the flag now goes.
   *
   * Gone as well, with the split, is the line that told the generator the
   * thread was waiting on an answer. It had no object left here: this component
   * is rendered only for contacts whose ball is in their court, and the reply
   * sheet carries that instruction on the path where it is true.
   */
  function brief(angle?: ProposedAngle): string {
    // Never emailed, but genuinely calling the API. Writing to them as a cold
    // prospect would pitch a product they already use; the old brief said so
    // explicitly, and said not to sell.
    const activeUser = c.messages.length === 0 && c.kind === 'client' && c.apiKey.usedAllTime > 0;
    return [
      `Contact: ${c.company || c.email}`,
      c.sourcing?.whatTheyDo ? `What they do: ${c.sourcing.whatTheyDo}` : '',
      c.sourcing?.personalizationHook ? `Hook: ${c.sourcing.personalizationHook}` : '',
      // Through the function like every other reader, though crm-app never
      // routes an institution here: one way of naming a state, so a surface
      // cannot pick the wrong vocabulary by forgetting the question exists.
      s ? `Goal: ${nextActionLabel(s.nextAction, c.kind)}` : '',
      // Verbatim, both fields: the operator chose this angle by reading these
      // very words, so anything reworded here would steer a draft they did not
      // choose. Em dashes are scrubbed upstream, on all three fields.
      //
      // The two fields come back in French since 28/07, because they are read
      // and never sent. Both draft prompts pin the mail to ENGLISH, so this
      // does not decide the language, and the label says so rather than
      // leaving a French instruction sitting unexplained in an English brief.
      angle
        ? `Angle to take, written in French because the operator reads it, steering only, the mail itself stays in English: ${angle.title}. ${angle.hint}`
        : '',
      c.messages.length
        ? `Thread so far:\n${threadTail(c.messages)}`
        : activeUser
          ? 'This person ALREADY uses IBANforge (they have made real API calls) but you have NEVER emailed them. Write a SHORT, warm, NON-salesy note from the founder: thank them for using it, then ask just two easy questions: (1) a brief bit of feedback on their experience so far, and (2) how they discovered IBANforge. Do NOT pitch features and do NOT ask for a call.'
          : 'No prior email: cold first touch.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Ask the VPS for two or three angles this follow-up could take.
   *
   * It asks nothing of the operator and replaces nothing they typed, so it
   * carries no confirmation: the question about overwriting lives in generate()
   * below, where the text that would be lost is finally known, and it must be
   * asked exactly once for one press of the button.
   *
   * Every way this can fail ends in a panel with a way out rather than in a
   * dead end. An operator who cannot reach the generator at all on a contact
   * whose next action is a follow-up would be worse off than before this
   * feature existed.
   */
  async function askAngles() {
    setBusy('angles');
    setMsg(null);
    setStep(null);
    try {
      const r = await fetch('/api/crm/relance-angles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact: c.sourcing?.whatTheyDo
            ? `${c.company || c.email}, ${c.sourcing.whatTheyDo}`
            : c.company || c.email,
          thread: threadTail(c.messages),
        }),
      });
      const a = await readAnswer(r);
      const angles = proposedAngles(a);
      // Null and empty are one case: both mean there is nothing to choose
      // between, whatever the status line said. The upstream promises two or
      // three and answers 502 below that, so either is already a broken
      // promise and the operator's way forward is the same.
      if (!angles || angles.length === 0) {
        setStep({ kind: 'failed', reason: withReason('Aucun angle proposé', reasonOf(a)) });
        return;
      }
      setStep({ kind: 'choose', angles });
    } catch {
      setStep({ kind: 'failed', reason: 'Erreur réseau, aucun angle proposé.' });
    } finally {
      setBusy(false);
    }
  }

  async function generate(angle?: ProposedAngle) {
    setBusy('gen');
    setMsg(null);
    try {
      const r = await fetch('/api/crm/generate-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: c.account,
          to: c.email,
          // A hint only: the VPS returns its own subject. The last subject of
          // the thread is what keeps a follow-up in the same thread as the mail
          // it follows, in the recipient's mailbox.
          subject: subject.trim() || c.messages.at(-1)?.subject || 'IBANforge',
          context: brief(angle),
          /*
           * Which system prompt the VPS writes with. Its follow-up mode asks
           * for two or three sentences, under sixty words, one new angle, and
           * no recap of the mail already sent; the default keeps the mode this
           * composer has always had, byte for byte.
           *
           * `isFollowup` and nothing else, which is the same expression that
           * names the button and opens the angle panel. Three decisions on one
           * reading of the situation: a second reading is a second answer
           * waiting to happen, and the one that would drift is this one, since
           * it is the only one of the three the operator cannot see.
           *
           * Written out even when false, though an absent field means the same
           * thing upstream. A flag that is sometimes absent and sometimes
           * false costs a reader of a captured request one deduction, and the
           * whole point of this line is to be legible on the wire.
           */
          follow_up: isFollowup,
          // deposit:false. The CRM keeps its own draft; nothing is written to
          // the mailbox. Note this does NOT make the call independent of mail
          // configuration: the VPS still refuses when the account has no
          // active mailbox with a password, and says so in `detail`.
          deposit: false,
        }),
      });
      const a = await readAnswer(r);
      const gen = generatedDraft(a);
      if (!gen) {
        setMsg({ text: withReason('Échec de la génération', reasonOf(a)), bad: true });
        return;
      }
      // Asked here and not before the call, so the question can be skipped when
      // the generation turns out to say what is already written, and so it is
      // never asked for nothing. The operator waited for a network round trip,
      // so a refusal has to say why nothing moved.
      if (!confirmReplace(gen.emailEn, 'La génération')) {
        setMsg({ text: 'Génération abandonnée, ton texte est intact.', bad: false });
        return;
      }
      setSubject(gen.subject || subject);
      setBody(gen.emailEn);
      setFr(gen.translationFr);
      // Something to read, in two languages: the sheet stands up for it.
      setExpanded(true);
      g.clear();
      // The panel goes when the draft it produced is in the composer, and not
      // a moment earlier. Closing it on the click would make a failed
      // generation cost a second round trip to get the same three angles back.
      setStep(null);
      setMsg({
        text: angle
          ? `✍️ Généré sur l’angle « ${angle.title} ». Rien n’a été déposé dans la boîte, relis avant d’envoyer.`
          : '✍️ Généré, rien n’a été déposé dans la boîte. Relis avant d’envoyer.',
        bad: false,
      });
    } catch {
      setMsg({ text: 'Erreur réseau, rien n’a été généré.', bad: true });
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    // Cleared before the question, not after it: an earlier "enregistré" left
    // on screen while the operator declines the overwrite reads as a save that
    // just happened.
    setMsg(null);
    // One draft per contact, and the store upserts on the address, so saving
    // destroys the previous one. Never silently.
    if (
      c.draft &&
      !window.confirm(
        'Un brouillon existe déjà pour ce contact. L’enregistrement va le remplacer. Continuer ?',
      )
    ) {
      return;
    }
    setBusy('draft');
    try {
      const r = await fetch('/api/crm/draft-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: c.email, subject, body, account: c.account }),
      });
      const a = await readAnswer(r);
      // 200 is not proof of a stored row, see lib/crm/api-result.ts.
      if (!changedRows(a, 'upserted')) {
        setMsg({
          text: withReason('Échec de l’enregistrement, rien n’a été gardé', reasonOf(a)),
          bad: true,
        });
        return;
      }
      // Cleared on success: the text now lives in the draft card in the thread,
      // which has its own send button. Leaving a copy here would give the same
      // mail two send buttons, and this sheet's send does not clear the card.
      setSubject('');
      setBody('');
      setFr(null);
      setStep(null);
      g.clear();
      // Folded back: the text is now the draft card in the thread, and that is
      // where the operator has to look at it.
      onOpenChange(false);
      setMsg({ text: '💾 Brouillon enregistré, il t’attend dans le fil.', bad: false });
      router.refresh();
    } catch {
      setMsg({ text: 'Erreur réseau, rien n’a été gardé.', bad: true });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Both halves of a send failure in one sentence: see draft-card.tsx. The
   * mail may have gone out on a call that reports a failure, and it is
   * precisely that mail the thread will not show, since /api/crm/send records
   * into the timeline only on a confirmed send.
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
        body: JSON.stringify({
          account: c.account,
          to: c.email,
          subject,
          body,
          intent: g.intent,
          override: g.forcedCodes,
        }),
      });
      const a = await readAnswer(r);
      if (!confirmedSent(a)) {
        sendFailed(reasonOf(a));
        return;
      }
      // Emptied at once, which also disables Envoyer: router.refresh() is not
      // awaitable, so this is what stands between a second click and a
      // duplicate mail.
      setSubject('');
      setBody('');
      setFr(null);
      // Same reason as the override below, one step earlier in the flow: the
      // angle belonged to the mail that has just left.
      setStep(null);
      // The override dies with the mail it covered. Without this the grant
      // would still be armed for the next draft written to this contact, and
      // the next blocked send would go out on a click the operator made for
      // another mail.
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

  // Guardrails gate the send and nothing else: a blocked draft can still be
  // saved, because parking a text that needs work is exactly what the draft is
  // for.
  const canSend = sendable && !g.blocked;
  // The store refuses a draft with no subject, so the button says so by being
  // off rather than by failing after the click.
  const canSaveDraft = !!c.email && filled && busy === false;
  // Unique per surface, and distinct from the reply sheet's and the draft
  // card's: two lists sharing an id would point every aria-describedby at the
  // first.
  const checksId = 'outbound-checks';

  /**
   * One button, two roads, and the fork is the situation rather than a second
   * control. A follow-up goes through the angles; everything else generates
   * straight away, exactly as it did before this step existed.
   *
   * The two copies of the button, folded and unfolded, share this and the
   * label below so they can never drift into offering different things.
   */
  function startGeneration() {
    if (isFollowup) void askAngles();
    else void generate();
  }
  const genLabel =
    busy === 'angles'
      ? '… angles'
      : busy === 'gen'
        ? '… génération'
        : isFollowup
          ? '✍️ Relancer'
          : '✍️ Générer';

  /**
   * Said beside the send button rather than handed to GuardrailChecks, which is
   * the draft card's way of showing it. The reason arrived with the move: the
   * dock scrolled as one piece, so the note and the button it describes could
   * not be separated, while here the check list scrolls and the button row does
   * not. Left in the list the note can be out of view with the armed red button
   * on screen, and red alone tells a colour-blind operator nothing about a send
   * that is about to ignore a rule.
   */
  const forcedNote = g.forcedNote && (
    <p className="mt-2 shrink-0 text-[12px] font-medium leading-snug text-red-300">
      ⚠️ {g.forcedNote}
    </p>
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
    // Deliberately not a second copy of the header's sentence, which already
    // says the address is missing. This one says what it costs here: there is
    // nothing to write into, and no button to press.
    return (
      <p className="mt-3 shrink-0 border-t border-[var(--ink-4)]/60 pt-3 text-[12px] text-amber-300">
        Envoi impossible tant que l’adresse n’est pas vérifiée.
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
            // aria-expanded only: the form it would control does not exist in
            // this state, and aria-controls pointing at an absent id is an
            // invalid reference rather than a hint.
            aria-expanded={false}
            className="min-w-0 flex-1 truncate rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)] px-3 py-1.5 text-left text-[13px] text-[var(--fg-3)] hover:border-amber-500/40 hover:text-[var(--fg-2)]"
          >
            {/* Folded text is not lost text: say it is there and unsaved. */}
            {hasText
              ? '✏️ Message en cours, ni enregistré ni envoyé'
              : `Écrire à ${c.company || c.email}`}
          </button>
          <button
            type="button"
            onClick={() => {
              // Unfolded first, and not only for the text that is coming: on a
              // follow-up this opens a panel of angles, which is rendered
              // inside the sheet and would otherwise have nowhere to appear.
              onOpenChange(true);
              startGeneration();
            }}
            disabled={busy !== false}
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[13px] font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
          >
            {genLabel}
          </button>
          {/* Gated on the thread being empty, here and on its twin below. The
              pre-written mail is the first mail and is never rewritten, so on
              a prospect already written to this button loaded the mail already
              sent back into the composer, next to Envoyer. See
              lib/crm/ready-mail.ts. */}
          {canLoadReadyMail(c) && (
            <button
              type="button"
              onClick={() => {
                onOpenChange(true);
                loadReadyMail();
              }}
              disabled={busy !== false}
              className="rounded-lg border border-[var(--ink-5)] px-3 py-1.5 text-[13px] text-[var(--fg-2)] hover:bg-[var(--ink-4)] disabled:opacity-50"
            >
              📄 Mail pré-rédigé
            </button>
          )}
        </div>
        {/* No forced note here, unlike the reply sheet's folded bar: that bar
            carries a send button and this one does not, so a grant given
            before folding has nothing to arm until the sheet is open again. */}
        {note}
      </div>
    );
  }

  return (
    // Over the foot of the panel, not inside its column: the thread above keeps
    // every pixel it had, and the panel gives back the room this covers as
    // scroll space. See OUTBOUND_SHEET_COVER_PX. Rounded at the bottom so the
    // corners do not poke out of the panel's own rounding.
    //
    // A column of three: who this is going to, then the mail, then the buttons.
    // Only the middle scrolls, so an angle panel, a translation or a check can
    // never push Envoyer out of reach, which is what a height cap did to the
    // dock this replaces.
    <div
      id="outbound-sheet"
      // Grown only while the angles are actually on offer: a failed step is a
      // short sentence that fits the resting region, and growing for it would
      // cover thread for nothing. See OUTBOUND_SHEET_ANGLES_PX. The expanded
      // mode wins over both: it is taller than the angles panel needs.
      style={{
        height: expanded
          ? 'min(85%, 720px)'
          : step?.kind === 'choose'
            ? OUTBOUND_SHEET_ANGLES_PX
            : OUTBOUND_SHEET_PX,
      }}
      className="absolute inset-x-0 bottom-0 z-10 flex flex-col border-t border-[var(--ink-4)] bg-[var(--ink-2)] p-3 shadow-[0_-10px_24px_-8px_rgba(0,0,0,0.65)]"
    >
      <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[12px] text-[var(--fg-3)]">
          À {c.company || c.email}, depuis {c.account}
        </span>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={toggleExpanded}
            aria-pressed={expanded}
            className="cursor-pointer text-[12px] text-[var(--fg-3)] underline underline-offset-2 hover:text-[var(--fg-1)]"
          >
            {expanded ? '⤡ réduire' : '⤢ agrandir'}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-expanded
            aria-controls="outbound-sheet"
            className="cursor-pointer text-[12px] text-[var(--fg-3)] underline underline-offset-2 hover:text-[var(--fg-1)]"
          >
            replier
          </button>
        </div>
      </div>
      <div ref={region} className="min-h-0 flex-1 overflow-y-auto">
        {/* Above the two fields rather than between them: this is a step that
            comes before writing, and slotting it under the subject would cut
            one message in half. It is also where the eye already is, one line
            under the header the operator just clicked past. */}
        {step && (
          <div className="mb-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-2">
            {step.kind === 'choose' ? (
              <>
                <p className="mb-1.5 text-[12px] font-medium text-amber-300">
                  Quel angle pour cette relance ?
                </p>
                {step.angles.map((a, i) => (
                  <button
                    // Position, never the upstream key: it is guaranteed
                    // neither filled nor unique, so two angles can share the
                    // empty string and React would hand one row's identity
                    // to the other. The list is replaced whole and never
                    // reordered, so the index is a stable identity here.
                    key={i}
                    type="button"
                    onClick={() => void generate(a)}
                    // A second click during the generation would send a
                    // second brief on the same press of the same panel.
                    disabled={busy !== false}
                    className="mb-1 block w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-amber-500/10 disabled:opacity-50"
                  >
                    <span className="text-[12px] font-semibold text-amber-300">{a.title}</span>
                    {/* The way out, named. It is the one angle the VPS
                        guarantees, and the operator has to be able to see
                        that it is the one that closes the conversation
                        rather than another attempt to open it. */}
                    {a.isExit && (
                      <span className="ml-1.5 text-[12px] text-[var(--fg-3)]">
                        (porte de sortie)
                      </span>
                    )}
                    <span className="mt-0.5 block text-[12px] leading-snug text-[var(--fg-3)]">
                      {a.hint}
                    </span>
                  </button>
                ))}
              </>
            ) : (
              <p role="alert" className="mb-1.5 text-[12px] leading-snug text-amber-300">
                {step.reason} Tu peux générer sans angle, ou écrire toi-même.
              </p>
            )}
            {/* Always both, in both states: the angles are an aid, and the
                mail has to be writable when the aid is not there. */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void generate()}
                disabled={busy !== false}
                className="rounded-md border border-[var(--ink-5)] px-2 py-1 text-[12px] text-[var(--fg-2)] hover:bg-[var(--ink-4)] disabled:opacity-50"
              >
                Générer sans angle
              </button>
              {/* Off while a call is in flight, like both its siblings.
                  Clicked during a generation it removed the panel and
                  nothing else: the fetch still landed, and on an empty
                  composer confirmReplace has nothing to protect, so it
                  returned true in silence and the subject and body filled
                  with a mail written on the angle the operator had just
                  cancelled. With text already typed it was a confirm dialog
                  for a step that was over. This is the feature whose premise
                  is that the operator decides what the model writes, so a
                  cancel that does not cancel is worse than a missing one. */}
              <button
                type="button"
                onClick={() => setStep(null)}
                disabled={busy !== false}
                className="text-[12px] text-[var(--fg-3)] underline underline-offset-2 hover:text-[var(--fg-1)] disabled:no-underline disabled:opacity-50"
              >
                annuler
              </button>
            </div>
          </div>
        )}
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Objet"
          aria-label="Objet du message"
          className="mb-2 w-full min-w-0 rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)] px-3 py-1.5 text-base text-[var(--fg-1)] focus:border-amber-500/40 focus:outline-none sm:text-sm"
        />
        {/* min-w-0 is load-bearing on a textarea: `cols` gives it an intrinsic
            minimum width that w-full does not remove, and that minimum would
            set a min-content floor the panel cannot absorb at 375px. */}
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          // A floor, not a height: the effect below sizes the field to what is
          // in it, so the inner scrollbar goes and the region scrolls alone.
          rows={6}
          placeholder="Écris, ou fais générer une relance."
          aria-label="Corps du message"
          className="w-full min-w-0 resize-none overflow-hidden rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)] p-3 text-base leading-[22px] sm:text-sm text-[var(--fg-1)] focus:border-amber-500/40 focus:outline-none"
        />
        {fr && (
          /*
           * Open on arrival: the translation is what the owner actually
           * reads to judge a draft, so hiding it behind a click made the
           * reading step optional on the one screen whose whole purpose is
           * to be read before sending. Still a `details`, so it can be
           * folded away when the English is enough.
           *
           * `key={fr}` because `open` is initial state only. Without it, a
           * translation folded once stays folded through every later
           * generation, since the node is never unmounted between two
           * non-null values and React would not re-apply the attribute.
           */
          <section
            aria-label="Traduction française du message"
            className="mt-2 rounded-lg border border-blue-500/25 bg-blue-500/5 p-2.5"
          >
            <p className="mb-1 text-[12px] font-medium text-blue-300">
              🌐 En français, pour toi seul. C’est le texte au-dessus qui part.
            </p>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--fg-2)] wrap-anywhere">
              {fr}
            </p>
          </section>
        )}
        <GuardrailChecks id={checksId} report={g.report} subject={subject} body={body} />
      </div>
      <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={startGeneration}
          disabled={busy !== false}
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[13px] font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
        >
          {genLabel}
        </button>
        {/* Same rule as the folded copy above, and the same call rather
            than a second reading of it. */}
        {canLoadReadyMail(c) && (
          <button
            type="button"
            onClick={loadReadyMail}
            disabled={busy !== false}
            className="rounded-lg border border-[var(--ink-5)] px-3 py-1.5 text-[13px] text-[var(--fg-2)] hover:bg-[var(--ink-4)] disabled:opacity-50"
          >
            📄 Mail pré-rédigé
          </button>
        )}
        <button
          type="button"
          onClick={saveDraft}
          disabled={!canSaveDraft}
          className="rounded-lg border border-[var(--ink-5)] px-3 py-1.5 text-[13px] text-[var(--fg-2)] hover:bg-[var(--ink-4)] disabled:opacity-50"
        >
          {busy === 'draft' ? '…' : '📝 Brouillon'}
        </button>
        {/* The override travels with the button it re-arms, in the same row
            rather than at the foot of the list: the list is in the part of
            this sheet that scrolls, so the red lines can be out of sight
            while the button is not. Both controls name the blocks, so what
            is being passed over is on the control under the cursor, at both
            clicks. */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {g.offer && <OverrideButton offer={g.offer} pressed={g.forced} onClick={g.toggle} />}
          <button
            type="button"
            onClick={send}
            // disabled, not aria-disabled. A focusable blocked button would
            // put the whole safety on one onClick guard; the cost is that a
            // keyboard user cannot tab to it to hear why, which the list
            // above and the override button both say in text.
            disabled={!canSend}
            aria-describedby={g.report.issues.length > 0 ? checksId : undefined}
            className={`rounded-lg px-4 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50 ${
              g.forced ? 'bg-red-600 hover:bg-red-500' : 'bg-green-600 hover:bg-green-500'
            }`}
          >
            {/* The label never changes with the grant: a wider button is a
                button that moves, and this one sits beside a toggle the
                cursor has just clicked. Red says it, and the note below
                writes it out for whoever does not see red. */}
            {busy === 'send' ? '… envoi' : 'Envoyer'}
          </button>
        </div>
      </div>
      {forcedNote}
      {note}
    </div>
  );
}
