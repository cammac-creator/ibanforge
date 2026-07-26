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
}: {
  contact: Contact;
  /** Undefined only if the page failed to derive one; the goal line is dropped then. */
  situation?: Situation;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [fr, setFr] = useState<string | null>(null);
  const [busy, setBusy] = useState<false | 'gen' | 'send' | 'draft'>(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  /**
   * The resting state, and it is not decoration.
   *
   * The panel is capped at 76vh and the thread is the flex child that absorbs
   * what is left. Measured with the form always open: 242px of dock against a
   * 370px client header left the thread 0px at 1100x900 and at 1100x700, i.e.
   * the reader disappeared to make room for the writer. Folded, the dock is
   * about 40px and the thread keeps its space until the operator actually
   * writes. This is the "repos" state the plan named and its code omitted.
   */
  const [open, setOpen] = useState(false);

  /** A prospect never contacted starts from its pre-written mail. */
  function loadReadyMail() {
    if (c.kind !== 'prospect' || !c.readyMail) return;
    const useFr = c.readyMail.recommendedLang === 'fr';
    setSubject((useFr ? c.readyMail.subjectFr : c.readyMail.subjectEn) ?? '');
    setBody((useFr ? c.readyMail.bodyFr : c.readyMail.bodyEn) ?? '');
    setFr(null);
    setMsg(null);
  }

  /** What the generator is told: who this is, where the thread stands, what to aim for. */
  function brief(): string {
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
        : 'No prior email: cold first touch.',
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
      setSubject(gen.subject || subject);
      setBody(gen.emailEn);
      setFr(gen.translationFr);
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

  const filled = !!subject.trim() && !!body.trim();
  const canSend = !!c.email && filled && busy === false;
  // The store refuses a draft with no subject, so the button says so by being
  // off rather than by failing after the click.
  const canSaveDraft = !!c.email && filled && busy === false;

  return (
    <div className="mt-3 shrink-0 border-t border-[var(--ink-4)]/60 pt-3">
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
            {filled ? '✏️ Message en cours, ni enregistré ni envoyé' : `Écrire à ${c.company || c.email}`}
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
            <button
              type="button"
              onClick={send}
              disabled={!canSend}
              className="ml-auto rounded-lg bg-green-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-green-500 disabled:opacity-50"
            >
              {busy === 'send' ? '… envoi' : 'Envoyer'}
            </button>
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
