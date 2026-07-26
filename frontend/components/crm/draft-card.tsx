'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { changedRows, confirmedSent, readAnswer, reasonOf, withReason } from '@/lib/crm/api-result';
import { formatStamp } from '@/lib/crm/format';
import type { Contact, Message, Situation } from '@/lib/crm/types';
import { GuardrailChecks, OverrideButton, useGuardrails } from './guardrails-ui';

/**
 * A CRM-native draft sitting in the thread: read it, adjust it in place, then
 * send it or discard it. One draft per contact, so saving overwrites.
 *
 * Nothing here ever touches the mailbox's own Drafts folder. The draft is a
 * row of email_messages with direction 'draft', which is what lets it be
 * reviewed here and what makes its send pass through /api/crm/send, hence
 * through recordSent(), hence into the timeline.
 *
 * It carries the same pre-send checks as the composer, and that is not
 * symmetry for its own sake: writing now and sending later is the flow this
 * card was built for, so a draft saved with an em dash, or any draft at all
 * once the daily cap is reached, would otherwise leave by the one door with no
 * lock on it. A guardrail with a documented way around it is not a guardrail.
 *
 * The caller must key this component on the draft's content (crm-app does):
 * the local state below is seeded on mount only, so without a key the card
 * would keep showing the previous contact's text after a selection change, or
 * stale text after the composer overwrote the draft.
 */
export function DraftCard({
  contact,
  draft,
  situation,
  sentToday,
}: {
  contact: Contact;
  draft: Message;
  /** Undefined only if the page failed to derive one; every rule falls to its warmer form. */
  situation?: Situation;
  /**
   * Real outbound mails dated today, counted by the page against one clock and
   * handed down untouched. Never recomputed here: msg_date carries no timezone
   * and this subtree is server-rendered before it is hydrated.
   */
  sentToday: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(draft.subject ?? '');
  const [body, setBody] = useState(draft.body ?? draft.snippet ?? '');
  const [busy, setBusy] = useState<false | 'send' | 'save' | 'del'>(false);
  // Latched on a confirmed send. router.refresh() is not awaitable and the
  // card stays mounted until the new payload arrives, so without this the send
  // button is live again the instant the request returns, and a second click
  // sends the same mail twice.
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const account = draft.counterparty || contact.account;
  const locked = busy !== false || sent;
  /**
   * Could this be sent at all, the checks aside. `locked` belongs in it: after
   * a confirmed send whose draft deletion failed, the card stays on screen with
   * Envoyer latched off, and offering an override there would put a control on
   * screen that does nothing when clicked.
   *
   * The checks read `subject` and `body`, the editable state, not the stored
   * row, so they follow the text the operator is actually about to send.
   */
  const sendable = !locked && !!contact.email && !!subject.trim() && !!body.trim();
  // Focused when the override is granted, same reason as in the composer.
  const sendRef = useRef<HTMLButtonElement>(null);
  const g = useGuardrails({ subject, body, sentToday, situation, sendable, sendRef });

  /**
   * Both halves of a send failure in one sentence.
   *
   * The mail may have gone out anyway: filing the Sent copy over IMAP has been
   * seen hanging past the proxy's own 40s budget, on a message SMTP had
   * already delivered, and the caller sees that as a failure. And because
   * /api/crm/send only records into the timeline on a confirmed send, that
   * mail is precisely the one the thread will NOT show. So the thread alone is
   * not where to look: the mailbox is.
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
        body: JSON.stringify({ account, to: contact.email, subject, body }),
      });
      const a = await readAnswer(r);
      if (!confirmedSent(a)) {
        sendFailed(reasonOf(a));
        return;
      }
      setSent(true);
      // The override dies with the mail it covered. The card can outlive the
      // send, when the draft row could not be deleted, and a grant left armed
      // there would cover a second click nobody granted.
      g.clear();
      // The draft row has to go, or the refresh brings back a card offering to
      // send the same mail again. The legacy card swallowed this failure; it
      // is the one that ends in a duplicate, so it gets said out loud.
      let removed = true;
      if (draft.id) {
        try {
          const d = await fetch('/api/crm/draft-message', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: draft.id }),
          });
          removed = changedRows(await readAnswer(d), 'deleted');
        } catch {
          removed = false;
        }
      }
      setMsg(
        removed
          ? { text: '✅ Envoyé, le brouillon devient un message du fil.', bad: false }
          : {
              text: '✅ Envoyé, mais le brouillon n’a pas pu être supprimé. Ne le renvoie pas : supprime-le à la main.',
              bad: true,
            },
      );
      router.refresh();
    } catch {
      sendFailed('Erreur réseau');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy('save');
    setMsg(null);
    try {
      const r = await fetch('/api/crm/draft-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: contact.email, subject, body, account }),
      });
      const a = await readAnswer(r);
      // 200 is not proof: the route answers { saved: true } whenever the call
      // itself worked, and the store skips a row it cannot key. Only the count
      // says the text is safe, and saying it is when it is not loses the text.
      if (!changedRows(a, 'upserted')) {
        setMsg({ text: withReason('Échec de l’enregistrement, le brouillon n’a pas changé', reasonOf(a)), bad: true });
        return;
      }
      setMsg({ text: '💾 Brouillon enregistré.', bad: false });
      // Saved text is a new draft to judge: the grant has to be asked again.
      g.clear();
      setEditing(false);
      router.refresh();
    } catch {
      setMsg({ text: 'Erreur réseau, le brouillon n’a pas changé.', bad: true });
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    // A draft row with no id cannot be addressed, and the endpoint keys the
    // deletion on it. Saying so beats a button that does nothing at all: the
    // legacy card returned here in silence.
    if (!draft.id) {
      setMsg({ text: 'Ce brouillon n’a pas d’identifiant : suppression impossible.', bad: true });
      return;
    }
    setBusy('del');
    setMsg(null);
    try {
      const r = await fetch('/api/crm/draft-message', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draft.id }),
      });
      const a = await readAnswer(r);
      if (!changedRows(a, 'deleted')) {
        setMsg({ text: withReason('Échec de la suppression, le brouillon est toujours là', reasonOf(a)), bad: true });
        return;
      }
      router.refresh();
    } catch {
      setMsg({ text: 'Erreur réseau, le brouillon est toujours là.', bad: true });
    } finally {
      setBusy(false);
    }
  }

  const stamp = formatStamp(draft.msg_date);
  // One draft per contact and one card on screen, so a constant id is unique
  // and stays readable. Distinct from the composer's, which can be open at the
  // same time: two lists sharing an id would make both aria-describedby point
  // at the first one.
  const checksId = 'draft-checks';

  return (
    // min-w-0 and wrap-anywhere for the same reason as the bubbles: a long
    // unbroken token in a draft body would otherwise set a min-content floor
    // that widens the whole page.
    <div className="min-w-0 rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 p-3 wrap-anywhere">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className="font-semibold text-amber-400">📝 brouillon, en attente de ta relecture</span>
        {stamp && (
          <span className="text-[var(--fg-3)]" title={draft.msg_date ?? undefined}>
            {stamp}
          </span>
        )}
        <span className="text-[var(--fg-3)]">· partira de {account}</span>
      </div>
      {editing ? (
        <div className="mt-2 flex flex-col gap-2">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            aria-label="Objet du brouillon"
            className="w-full min-w-0 rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)] px-3 py-1.5 text-xs text-[var(--fg-1)] focus:border-amber-500/40 focus:outline-none"
            placeholder="Objet"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            aria-label="Corps du brouillon"
            className="w-full min-w-0 rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)] p-3 text-xs leading-relaxed text-[var(--fg-1)] focus:border-amber-500/40 focus:outline-none"
          />
        </div>
      ) : (
        <>
          <p className="mt-1.5 text-xs font-medium text-[var(--fg-1)]">{subject || '(sans objet)'}</p>
          <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--fg-3)]">{body}</p>
        </>
      )}
      {/* Same panel and same words as the composer: the operator meets one
          vocabulary, not two, wherever the mail is about to leave from. */}
      <GuardrailChecks
        id={checksId}
        report={g.report}
        subject={subject}
        body={body}
        forcedNote={g.forcedNote}
      />
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          ref={sendRef}
          type="button"
          onClick={send}
          // disabled, not aria-disabled, as on the composer: a focusable
          // blocked button would rest the whole safety on one onClick guard.
          disabled={!sendable || g.blocked}
          aria-describedby={g.report.issues.length > 0 ? checksId : undefined}
          className={`rounded-lg px-3 py-1 text-xs font-semibold text-white transition-colors disabled:opacity-50 ${
            g.forced ? 'bg-red-600 hover:bg-red-500' : 'bg-green-600 hover:bg-green-500'
          }`}
        >
          {/* Constant width whatever the grant: see the composer, and see
              OverrideButton for what a growing label did to this row. */}
          {busy === 'send' ? '… envoi' : sent ? 'envoyé' : '✅ Envoyer'}
        </button>
        {/* Next to the button it re-arms, exactly as in the composer, and a
            toggle rather than a control that vanishes on use: this row is left
            aligned in DOM order, so an unmount here would pull Modifier and an
            unconfirmed Supprimer left, under the cursor that had just clicked.
            discard() asks nothing before destroying the draft. */}
        {g.offer && <OverrideButton offer={g.offer} pressed={g.forced} onClick={g.toggle} dense />}
        {editing ? (
          <button
            type="button"
            onClick={save}
            disabled={locked || !subject.trim() || !body.trim()}
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
          >
            {busy === 'save' ? '… enregistrement' : '💾 Enregistrer'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={locked}
            className="rounded-lg border border-[var(--ink-5)] px-3 py-1 text-xs font-medium text-[var(--fg-2)] hover:bg-[var(--ink-4)] disabled:opacity-50"
          >
            ✏️ Modifier
          </button>
        )}
        {/* busy, not locked, and this is the one button where the difference
            matters. The failure this card exists to handle is a confirmed send
            whose draft deletion failed, and its message tells the operator to
            delete the draft by hand. Under `locked` the send latch greyed this
            button out for good, since the refresh returns the same row and
            draftKey is unchanged so the instance survives with `sent` still
            set: the interface printed an instruction and disabled the only way
            to follow it. The latch stays on Envoyer, which is the actual
            duplicate-send guard. */}
        <button
          type="button"
          onClick={discard}
          disabled={busy !== false}
          className="rounded-lg px-3 py-1 text-xs text-[var(--fg-3)] hover:text-red-400 disabled:opacity-50"
        >
          {busy === 'del' ? '…' : '🗑 Supprimer'}
        </button>
      </div>
      {msg && (
        // alert for a failure: it is the answer to something the operator just
        // did, and at least one of them says not to click again.
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
