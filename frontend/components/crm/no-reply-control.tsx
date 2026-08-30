'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { lastInboundMessage } from '@/lib/crm/no-reply';
import type { Contact } from '@/lib/crm/types';

/**
 * « Rien à répondre » — the one gesture for an exchange that goes no further.
 *
 * The hole it fills, in the operator's words: "je ne trouve toujours pas
 * comment traiter des échanges qui ne donneront pas suite (remerciement, bot,
 * message auto)". A thank-you from an authority sat in « À répondre » for ever,
 * because the last message is inbound and nothing could say otherwise.
 *
 * Two things kept OutcomeControl from serving, and this control answers both:
 *
 *   1. It renders for EVERY kind of contact. OutcomeControl is drawn under
 *      `{sourcing && …}`, so a self-service customer and an institutional
 *      correspondent — the two populations that send most of the mail nobody
 *      needs to answer — had no control at all. This one reads messages, which
 *      every contact has, and owes nothing to a prospect row.
 *   2. It says the right thing. The four outcomes describe a COMMERCIAL
 *      RELATIONSHIP; filing a warm thank-you under « pas intéressé » would be
 *      false about the person and would corrupt the counters those verdicts
 *      feed.
 *
 * The mark is on the MESSAGE, and the button says so ("leur dernier message").
 * That is what makes it self-undoing: write to us again and the thread is back
 * in the queue with no rule to run. See lib/crm/no-reply.ts.
 *
 * Its own file rather than a block in contact-header.tsx, same reason as
 * prospect-status.tsx: it is the part that needs a router and local state, so
 * the directive stays out of the header.
 */

/**
 * Who the standing rule would be about.
 *
 * The counterparty of the message just marked, NOT the contact's address, and
 * the difference is the ordinary case rather than a corner: the acknowledgement
 * arrives from `no-reply@autorite.example` while the dossier is filed under the
 * desk address we write to. A rule keyed on the contact would silence the desk
 * — the humans — and leave the robot untouched, which is the exact inverse of
 * what was asked. Falls back to the contact's address only when the row carries
 * no sender at all, and the address is PRINTED to the operator either way: a
 * rule he cannot read before accepting is a rule he cannot refuse.
 */
function senderOf(c: Contact, from: string | null): string | null {
  const address = (from ?? c.email ?? '').trim().toLowerCase();
  return address.includes('@') ? address : null;
}

export function NoReplyControl({ contact: c }: { contact: Contact }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // The second gesture is offered only in the breath after the first one, never
  // on opening the file. A standing rule that buries an authority's future mail
  // is worse than the problem it solves, so it is never one click away from a
  // click that meant something else.
  const [offerRule, setOfferRule] = useState(false);
  const [ruleSet, setRuleSet] = useState(false);

  const target = lastInboundMessage(c);
  // The id is what the endpoint marks, so no id is the same case as no message.
  // Nothing they said, nothing to mark: the button would be a no-op wearing a
  // reassuring label, which is the one thing a control must never be — and the
  // question does not arise anyway, since with no inbound message the ball is
  // not in our court.
  const targetId = target?.id;
  if (!target || !targetId) return null;

  const marked = target.no_reply_needed === 1;
  const sender = senderOf(c, target.counterparty);

  async function send(value: boolean) {
    setBusy(true);
    setFailed(null);
    try {
      const r = await fetch('/api/crm/no-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: targetId, value }),
      });
      // 200 is not proof of a change: the endpoint answers { updated: n } and
      // refuses anything that is not an inbound message, so a stale id comes
      // back 200 with 0. Same reading as the outcome control beside it, and the
      // same reason — a silent refresh would leave the operator believing the
      // thread had left his queue when it had not.
      const body: unknown = await r.json().catch(() => null);
      const updated =
        body && typeof body === 'object' && 'updated' in body ? (body as { updated: unknown }).updated : undefined;
      if (!r.ok || updated === 0) {
        setFailed('échec, rien n’a été enregistré');
        return;
      }
      setOfferRule(value);
      setRuleSet(false);
      router.refresh();
    } catch {
      setFailed('échec, rien n’a été enregistré');
    } finally {
      setBusy(false);
    }
  }

  async function ruleForSender() {
    if (!sender) return;
    setBusy(true);
    setFailed(null);
    try {
      const r = await fetch('/api/crm/no-reply-sender', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: sender, value: true }),
      });
      // Read on `ok` alone, and this is the weakest of the three readings here:
      // the endpoint's answer shape is not fixed by the contract, and a rule
      // already recorded legitimately changes zero rows. Saying "failed" on an
      // idempotent repeat would teach the operator to distrust the alert.
      if (!r.ok) {
        setFailed('la règle n’a pas été enregistrée');
        return;
      }
      setRuleSet(true);
    } catch {
      setFailed('la règle n’a pas été enregistrée');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-[var(--ink-4)]/60 pt-3 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[var(--fg-3)]">Leur dernier message :</span>
        <button
          type="button"
          disabled={busy}
          aria-pressed={marked}
          onClick={() => void send(!marked)}
          title={
            marked
              ? 'Cliquer à nouveau pour retirer ce marqueur'
              : 'Sort le fil de « À répondre ». S’ils réécrivent, il y revient tout seul.'
          }
          className="cursor-pointer rounded-full px-2 py-0.5 font-medium transition-colors disabled:cursor-default disabled:opacity-50"
          style={
            marked
              ? { color: '#7dd3fc', backgroundColor: '#7dd3fc22' }
              : { color: 'var(--fg-3)', backgroundColor: 'var(--ink-4)' }
          }
        >
          Rien à répondre
        </button>
      </div>

      {marked && (
        <p className="mt-2 text-[var(--fg-3)]">
          Ce fil n’est plus dans « À répondre ». Un nouveau message de leur part l’y remettra.
        </p>
      )}

      {/* The standing rule, proposed and never applied on its own. The address
          is spelled out because it is often NOT the one on the file: the robot
          writes from one mailbox and the humans from another. */}
      {offerRule && sender && !ruleSet && (
        <div className="mt-2 rounded-lg border border-[var(--ink-4)] bg-[var(--ink-1)] p-2">
          <p className="wrap-anywhere text-[var(--fg-2)]">
            Faire pareil pour ce correspondant à l’avenir ? Tout nouveau message de{' '}
            <b className="text-[var(--fg-1)]">{sender}</b> arrivera déjà marqué.
          </p>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void ruleForSender()}
              className="cursor-pointer rounded bg-sky-500/20 px-2 py-1 font-medium text-sky-300 disabled:cursor-default disabled:opacity-50"
            >
              Oui, toujours
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setOfferRule(false)}
              className="cursor-pointer text-[var(--fg-3)] underline underline-offset-2 hover:text-[var(--fg-1)]"
            >
              non, cette fois seulement
            </button>
          </div>
        </div>
      )}

      {ruleSet && sender && (
        // status, not alert: the operator asked for this and is being told it
        // took, which is not an interruption.
        <p role="status" className="mt-2 wrap-anywhere text-sky-300">
          Règle enregistrée : les prochains messages de {sender} arriveront marqués.
        </p>
      )}

      {/* alert, not status: raised by something the operator just did. The
          endpoints ship from another platform than this page, so a 404 while
          the API catches up must say so here rather than break the file. */}
      {failed && (
        <p role="alert" className="mt-2 text-red-400">
          {failed}
        </p>
      )}
    </div>
  );
}
