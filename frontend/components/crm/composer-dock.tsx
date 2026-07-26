'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  changedRows,
  confirmedSent,
  generatedDraft,
  readAnswer,
  reasonOf,
  withReason,
} from '@/lib/crm/api-result';
import { NEXT_ACTION_LABEL } from '@/lib/crm/situation';
import type { Contact, Situation } from '@/lib/crm/types';
import { GuardrailChecks, OverrideButton, useGuardrails } from './guardrails-ui';

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
  const [busy, setBusy] = useState<false | 'gen' | 'send' | 'draft'>(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
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

  /** A prospect never contacted starts from its pre-written mail. */
  function loadReadyMail() {
    if (c.kind !== 'prospect' || !c.readyMail) return;
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
    g.clear();
  }

  /**
   * What the generator is told: who this is, where the thread stands, what to
   * aim for, and the one thing it must never write.
   *
   * Two of these lines are restored from the brief the Clients page built
   * before the refactor, kept in its own shape and wording rather than
   * reworded, because both were lost silently when that page went away and the
   * proxy forwards this text verbatim: there is no other place they could
   * live.
   */
  function brief(): string {
    // Never emailed, but genuinely calling the API. Writing to them as a cold
    // prospect would pitch a product they already use; the old brief said so
    // explicitly, and said not to sell.
    const activeUser = c.messages.length === 0 && c.kind === 'client' && c.apiKey.usedAllTime > 0;
    return [
      `Contact: ${c.company || c.email}`,
      c.sourcing?.whatTheyDo ? `What they do: ${c.sourcing.whatTheyDo}` : '',
      c.sourcing?.personalizationHook ? `Hook: ${c.sourcing.personalizationHook}` : '',
      s ? `Goal: ${NEXT_ACTION_LABEL[s.nextAction]}` : '',
      c.messages.length
        ? `Thread so far:\n${c.messages
            .slice(-4)
            .map((m) => `[${m.direction === 'in' ? 'them' : 'me'} ${m.msg_date ?? ''}] ${m.snippet ?? ''}`)
            .join('\n')}`
        : activeUser
          ? 'This person ALREADY uses IBANforge (they have made real API calls) but you have NEVER emailed them. Write a SHORT, warm, NON-salesy note from the founder: thank them for using it, then ask just two easy questions: (1) a brief bit of feedback on their experience so far, and (2) how they discovered IBANforge. Do NOT pitch features and do NOT ask for a call.'
          : 'No prior email: cold first touch.',
      // Confidentiality, and it only exists here. Gated on the recipient so the
      // line is absent for everyone else: naming the rule to the model for a
      // contact it does not concern would teach it a name it would otherwise
      // never see. Lowercased before matching, which the original did not do,
      // because a capitalised domain would silently drop the net.
      c.email.toLowerCase().includes('ib4.net') ? 'IMPORTANT: never mention "IB4" anywhere.' : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  async function generate() {
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
          context: brief(),
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
      setMsg({ text: '✍️ Généré, rien n’a été déposé dans la boîte. Relis avant d’envoyer.', bad: false });
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
    <div className="mt-3 shrink-0 overflow-y-auto border-t border-[var(--ink-4)]/60 pt-3 [@media(max-height:780px)]:max-h-[30vh]">
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
              setOpen(true);
              void generate();
            }}
            disabled={busy !== false}
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
          >
            {busy === 'gen' ? '… génération' : '✍️ Générer'}
          </button>
          {c.kind === 'prospect' && c.readyMail && (
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
          <GuardrailChecks id="composer-checks" report={g.report} subject={subject} body={body} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={generate}
              disabled={busy !== false}
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
            >
              {busy === 'gen' ? '… génération' : '✍️ Générer'}
            </button>
            {c.kind === 'prospect' && c.readyMail && (
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
              {g.offer && <OverrideButton offer={g.offer} onClick={g.grant} />}
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
                {busy === 'send' ? '… envoi' : g.forced ? g.forcedLabel : 'Envoyer'}
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
