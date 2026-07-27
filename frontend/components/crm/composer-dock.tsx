'use client';

import { useState } from 'react';
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
import { NEXT_ACTION_LABEL } from '@/lib/crm/situation';
import { threadTail } from '@/lib/crm/thread-tail';
import type { Contact, Situation } from '@/lib/crm/types';
import { GuardrailChecks, OverrideButton, useGuardrails } from './guardrails-ui';

/**
 * The angle step, and its failure, in one value: on screen they are one moment,
 * a panel that opens under the operator's click and either offers the angles or
 * says why it cannot. Both states carry the same way out, which is what keeps
 * the promise that a follow-up can always be written, angles or no angles.
 *
 * `choose` never holds an empty list: nothing to choose between is a failure
 * with a different sentence, not a panel of no buttons.
 */
type AngleStep =
  | { kind: 'choose'; angles: ProposedAngle[] }
  | { kind: 'failed'; reason: string };

/**
 * The composer, docked at the foot of the detail panel and outside the part
 * that scrolls, so writing is always one click away from reading the thread.
 *
 * Three ways in, one way out. The operator writes from scratch, loads the
 * prospect's pre-written mail, or asks for a generation; then either sends, or
 * parks the text as a CRM-native draft that comes back as a card in the thread.
 *
 * Nothing here writes to the mailbox's Drafts folder: every generation passes
 * `deposit: false`. That is the point of the flag. The IMAP deposit put the
 * draft somewhere the CRM cannot see, so the operator left the app to send it,
 * and that send never passed through recordSent(), which left a hole in the
 * timeline.
 *
 * The caller must key this on the contact id (crm-app does). The text below is
 * local state; without a key, selecting another contact would keep it, and the
 * next click on Envoyer would send one contact's mail to another.
 */
export function ComposerDock({
  contact: c,
  situation: s,
  sentToday,
  open,
  onOpenChange,
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
   * Folded or unfolded. Controlled by the panel rather than held here, because
   * folding changes how tall the thread is and the panel has to re-anchor it on
   * the newest message afterwards, which it can only do in an effect that
   * depends on this.
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [fr, setFr] = useState<string | null>(null);
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
  /*
   * The resting state, and it is not decoration. The panel is capped at 76vh
   * and the thread is the flex child that absorbs what is left, so a form that
   * is always open takes the reader away to make room for the writer: measured
   * at 242px of dock against a 370px header, the thread was 0px at 1100x900.
   * Folded the dock is 43px. This is the "repos" state the plan named and its
   * code omitted. The state itself lives in the panel, see the prop above.
   */
  const setOpen = onOpenChange;

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
   * Could this be sent at all, the checks aside. It is what stops a blank mail,
   * and it has to: none of the checks asks whether anything was written. Two of
   * them even fire on an untouched draft, the daily cap on the counter and the
   * missing opt-out on a cold first touch, so "no issue" never means "ready to
   * send" and "blocking" never means "there is text worth blocking".
   */
  const sendable = !!c.email && filled && busy === false;
  const g = useGuardrails({ subject, body, sentToday, situation: s, sendable });

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
    setFr(null);
    setMsg(null);
    // An angle chosen for a mail that is no longer the one being written.
    setStep(null);
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
      s ? `Goal: ${NEXT_ACTION_LABEL[s.nextAction]}` : '',
      // Verbatim, both fields: the operator chose this angle by reading these
      // very words, so anything reworded here would steer a draft they did not
      // choose. Em dashes are scrubbed upstream, on all three fields.
      angle ? `Angle to take: ${angle.title}. ${angle.hint}` : '',
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
          // the thread keeps a reply close to what it answers.
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
    if (c.draft && !window.confirm('Un brouillon existe déjà pour ce contact. L’enregistrement va le remplacer. Continuer ?')) {
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
        setMsg({ text: withReason('Échec de l’enregistrement, rien n’a été gardé', reasonOf(a)), bad: true });
        return;
      }
      // Cleared on success: the text now lives in the draft card in the thread,
      // which has its own send button. Leaving a copy here would give the same
      // mail two send buttons, and the composer's send does not clear the card.
      setSubject('');
      setBody('');
      setFr(null);
      setStep(null);
      g.clear();
      // Folded back: the text is now the draft card in the thread, and that is
      // where the operator has to look at it.
      setOpen(false);
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
        body: JSON.stringify({ account: c.account, to: c.email, subject, body }),
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
      setOpen(false);
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
   * How tall the dock may get, and why the angle panel changes the answer.
   *
   * The rule below the return caps the dock at 30vh under 780px of viewport,
   * where an open composer took the whole thread. Above 780px it was left
   * uncapped because the dock's natural 264px fits. The angle panel breaks that
   * premise: it adds 248px, and measured at 1100x900 the dock went to 520px and
   * the thread from 141px to **0**, which is the very failure the 30vh rule
   * exists to prevent, arriving on a window that rule does not cover. Same at
   * 1280x800 and 375x800.
   *
   * So a second cap, and only while the panel is up. 40vh and not 30 because
   * the panel plus the form's own header is 268px, which 40vh of 900 holds
   * whole while leaving the thread its natural 141px; measured, 30vh there
   * would have cut the panel itself.
   *
   * An unconditional 40vh with the existing query overriding it, rather than
   * two queries that split the range between them.
   *
   * The first attempt paired `min-height:781px` with `max-height:780px`, on the
   * reasoning that two exclusive queries cannot be decided by the order
   * Tailwind emits them in. They are exclusive, but they are not exhaustive: a
   * viewport of 780.4 CSS pixels, which browser zoom and display scaling
   * produce routinely, matches neither. The dock was then uncapped with a 248px
   * panel on top of it, which is the 0px thread this cap exists to prevent,
   * hiding in the one band the arithmetic did not cover.
   *
   * A base utility cannot have that hole: it applies at every height, and the
   * query only takes over below 780. The ordering that worried the first
   * attempt is the ordinary Tailwind cascade, a variant over the utility it
   * varies, and it is measured below rather than assumed: 30vh at 700, 40vh at
   * 780.4 and at 900.
   */
  const dockCap = step
    ? 'max-h-[40vh] [@media(max-height:780px)]:max-h-[30vh]'
    : '[@media(max-height:780px)]:max-h-[30vh]';

  return (
    // The cap, and why it is on a height query rather than flat.
    //
    // What the thread gets is what this dock leaves, and open the dock is a
    // fixed 265px whatever the window, so on a short one it took the last of
    // the thread. Capped at 30vh it scrolls inside itself instead: measured,
    // the thread goes from 0 to 141px at 1100x700 and from 0 to 39px at
    // 1100x480. 30 and not 40 because the panel's own padding and margins eat
    // 68px a naive budget forgets, and at 40vh the thread was still 0 at 480.
    //
    // But the cap has a cost, seen in a capture rather than in the numbers: at
    // 375x800 the button row wraps, the dock wants 281px, and 30vh of 800 cut
    // it to 240, which put Envoyer below the dock's own fold. That window is
    // narrow, not short: uncapped it still leaves the thread 124px. So the cap
    // applies only under 780px of viewport height, where it is the difference
    // between a readable thread and none. Above that the dock keeps its
    // natural height and every control stays in view. Folded the bar is 43px,
    // far under the cap, so the resting state never sees any of this.
    //
    // The angle panel adds a second cap above 780px, for the same reason and
    // measured the same way: see dockCap.
    <div className={`mt-3 shrink-0 overflow-y-auto border-t border-[var(--ink-4)]/60 pt-3 ${dockCap}`}>
      {!c.email ? (
        // Deliberately not a second copy of the header's sentence, which
        // already says the address is missing. This one says what it costs
        // here: there is nothing to write into, and no button to press.
        <p className="text-[11px] text-amber-300">
          Envoi impossible tant que l’adresse n’est pas vérifiée.
        </p>
      ) : !open ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            // aria-expanded only: the form it would control does not exist in
            // this state, and aria-controls pointing at an absent id is an
            // invalid reference rather than a hint.
            aria-expanded={false}
            className="min-w-0 flex-1 truncate rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)] px-3 py-1.5 text-left text-xs text-[var(--fg-3)] hover:border-amber-500/40 hover:text-[var(--fg-2)]"
          >
            {/* Folded text is not lost text: say it is there and unsaved. */}
            {hasText ? '✏️ Message en cours, ni enregistré ni envoyé' : `Écrire à ${c.company || c.email}`}
          </button>
          <button
            type="button"
            onClick={() => {
              // Unfolded first, and not only for the text that is coming: on a
              // follow-up this opens a panel of angles, which is rendered
              // inside the form and would otherwise have nowhere to appear.
              setOpen(true);
              startGeneration();
            }}
            disabled={busy !== false}
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
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
                setOpen(true);
                loadReadyMail();
              }}
              disabled={busy !== false}
              className="rounded-lg border border-[var(--ink-5)] px-3 py-1.5 text-xs text-[var(--fg-2)] hover:bg-[var(--ink-4)] disabled:opacity-50"
            >
              📄 Mail pré-rédigé
            </button>
          )}
        </div>
      ) : (
        <div id="composer-form">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[11px] text-[var(--fg-3)]">
              À {c.company || c.email}, depuis {c.account}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-expanded
              aria-controls="composer-form"
              className="shrink-0 cursor-pointer text-[11px] text-[var(--fg-3)] underline underline-offset-2 hover:text-[var(--fg-1)]"
            >
              replier
            </button>
          </div>
          {/* Above the two fields rather than between them: this is a step
              that comes before writing, and slotting it under the subject
              would cut one message in half. It is also where the eye already
              is, one line under the header the operator just clicked past. */}
          {step && (
            <div className="mb-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-2">
              {step.kind === 'choose' ? (
                <>
                  <p className="mb-1.5 text-[11px] font-medium text-amber-300">
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
                      <span className="text-[11px] font-semibold text-amber-300">{a.title}</span>
                      {/* The way out, named. It is the one angle the VPS
                          guarantees, and the operator has to be able to see
                          that it is the one that closes the conversation
                          rather than another attempt to open it. */}
                      {a.isExit && (
                        <span className="ml-1.5 rounded border border-[var(--ink-5)] px-1 py-px text-[10px] text-[var(--fg-3)]">
                          porte de sortie
                        </span>
                      )}
                      <span className="mt-0.5 block text-[10px] leading-snug text-[var(--fg-3)]">
                        {a.hint}
                      </span>
                    </button>
                  ))}
                </>
              ) : (
                <p role="alert" className="mb-1.5 text-[11px] leading-snug text-amber-300">
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
                  className="rounded-md border border-[var(--ink-5)] px-2 py-1 text-[11px] text-[var(--fg-2)] hover:bg-[var(--ink-4)] disabled:opacity-50"
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
                  className="text-[11px] text-[var(--fg-3)] underline underline-offset-2 hover:text-[var(--fg-1)] disabled:no-underline disabled:opacity-50"
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
            className="mb-2 w-full min-w-0 rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)] px-3 py-1.5 text-sm text-[var(--fg-1)] focus:border-amber-500/40 focus:outline-none"
          />
          {/* min-w-0 is load-bearing on a textarea: `cols` gives it an intrinsic
              minimum width that w-full does not remove, and that minimum would
              set a min-content floor the panel cannot absorb at 375px. */}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            placeholder="Écris, ou fais générer une relance."
            aria-label="Corps du message"
            className="w-full min-w-0 rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)] p-3 text-xs leading-relaxed text-[var(--fg-1)] focus:border-amber-500/40 focus:outline-none"
          />
          {fr && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[10px] text-blue-400">
                Traduction FR (pour toi seul, jamais envoyée)
              </summary>
              <p className="mt-1 whitespace-pre-wrap text-[11px] text-[var(--fg-3)] wrap-anywhere">{fr}</p>
            </details>
          )}
          <GuardrailChecks
            id="composer-checks"
            report={g.report}
            subject={subject}
            body={body}
            forcedNote={g.forcedNote}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={startGeneration}
              disabled={busy !== false}
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
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
                className="rounded-lg border border-[var(--ink-5)] px-3 py-1.5 text-xs text-[var(--fg-2)] hover:bg-[var(--ink-4)] disabled:opacity-50"
              >
                📄 Mail pré-rédigé
              </button>
            )}
            <button
              type="button"
              onClick={saveDraft}
              disabled={!canSaveDraft}
              className="rounded-lg border border-[var(--ink-5)] px-3 py-1.5 text-xs text-[var(--fg-2)] hover:bg-[var(--ink-4)] disabled:opacity-50"
            >
              {busy === 'draft' ? '…' : '📝 Brouillon'}
            </button>
            {/* The override travels with the button it re-arms, in the same
                row rather than at the foot of the list: under 780px of
                viewport the dock is capped and scrolls inside itself, so the
                red lines can be out of sight while the button is not. Both
                controls name the blocks, so what is being passed over is on
                the control under the cursor, at both clicks. */}
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
                aria-describedby={g.report.issues.length > 0 ? 'composer-checks' : undefined}
                className={`rounded-lg px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${
                  g.forced ? 'bg-red-600 hover:bg-red-500' : 'bg-green-600 hover:bg-green-500'
                }`}
              >
                {/* The label never changes with the grant: a wider button is a
                    button that moves, and this one sits beside a toggle the
                    cursor has just clicked. Red says it, and the panel writes
                    it out for whoever does not see red. */}
                {busy === 'send' ? '… envoi' : 'Envoyer'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Outside the fold: a send that succeeds folds the dock back, and the
          operator still has to be told what happened. */}
      {msg && (
        <p
          role={msg.bad ? 'alert' : 'status'}
          className={`mt-2 text-[11px] ${msg.bad ? 'text-red-400' : 'text-[var(--fg-2)]'}`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
