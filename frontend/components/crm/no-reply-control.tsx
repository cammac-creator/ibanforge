'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { isRobotAddress } from '@/lib/crm/automated';
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
 * The mark is on the MESSAGE, and the title says so. That is what makes it
 * self-undoing: write to us again and the thread is back in the queue with no
 * rule to run. See lib/crm/no-reply.ts.
 *
 * Its own file rather than a block in contact-header.tsx, same reason as
 * prospect-status.tsx: it is the part that needs a router and local state, so
 * the directive stays out of the header.
 *
 * ## Where it renders, and what the first placement cost
 *
 * It sits in SituationBand's action line, handed in as that component's
 * `action` slot. It shipped first at the bottom of ContactDetail — inside the
 * scrolling region, below the qualification blocks, the notes and the activity
 * chart — and the operator came back a day later saying he still could not
 * classify a thank-you. Nothing was broken: both endpoints answered, the
 * marker persisted, the queues honoured it. He never scrolled that far, and
 * there was no reason he should have. The question is asked in the pinned band
 * (« ⚠ À TOI DE JOUER »), so the answer has to be offered there.
 *
 * That is also why this file draws no label of its own any more and no longer
 * explains itself in a paragraph. The band states the situation in colour and
 * in words on the very line this control sits on, and re-stating it beside
 * itself is how one screen ends up with two vocabularies.
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
  // `||` and not `??`: a row carrying an empty counterparty says no more than
  // one carrying null, and `??` would take the empty string as an answer and
  // then refuse to offer the rule at all.
  const address = (from || c.email || '').trim().toLowerCase();
  if (!address.includes('@')) return null;
  // And only where no human can write from. The 30/08/2026 review reproduced
  // what the fallback above costs without this line: a rule accepted on an
  // ordinary correspondent stamped his NEXT message — a real production
  // incident — as needing no answer, and the thread left every queue with
  // nothing to bring it back. The API refuses such a rule too (422); refusing
  // to OFFER it is what keeps the operator from meeting that refusal at all.
  return isRobotAddress(address) ? address : null;
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

  async function ruleForSender(value: boolean = true) {
    if (!sender) return;
    setBusy(true);
    setFailed(null);
    try {
      const r = await fetch('/api/crm/no-reply-sender', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: sender, value }),
      });
      // Read on `ok` alone, and this is the weakest of the three readings here:
      // the endpoint's answer shape is not fixed by the contract, and a rule
      // already recorded legitimately changes zero rows. Saying "failed" on an
      // idempotent repeat would teach the operator to distrust the alert.
      if (!r.ok) {
        setFailed('la règle n’a pas été enregistrée');
        return;
      }
      setRuleSet(value);
    } catch {
      setFailed('la règle n’a pas été enregistrée');
    } finally {
      setBusy(false);
    }
  }

  return (
    // Right-aligned and narrow: it shares a row with the band's action line,
    // and the two panels below only ever appear in the breath after a click.
    <div className="flex max-w-[22rem] shrink-0 flex-col items-end gap-2 text-[12px]">
      <button
        type="button"
        disabled={busy}
        aria-pressed={marked}
        onClick={() => void send(!marked)}
        title={
          marked
            ? 'Leur dernier message est marqué comme n’attendant pas de réponse. Cliquer à nouveau pour le retirer.'
            : 'Leur dernier message n’attend pas de réponse (remerciement, accusé de réception, robot). Sort le fil de « À répondre ». S’ils réécrivent, il y revient tout seul.'
        }
        // Outlined rather than filled while it is an offer: it sits on a tinted
        // band that is already carrying a colour, and a second filled pill
        // there reads as a second verdict. Filled once pressed, because then it
        // IS the verdict and the band has turned the same sky to say so.
        className={`cursor-pointer whitespace-nowrap rounded-full border px-2.5 py-1 font-medium transition-colors disabled:cursor-default disabled:opacity-50 ${
          marked
            ? 'border-sky-400/50 bg-sky-400/20 text-sky-200'
            : 'border-sky-300/35 bg-sky-300/5 text-sky-200/85 hover:border-sky-300/60 hover:bg-sky-300/15'
        }`}
      >
        Rien à répondre
      </button>

      {/* The standing rule, proposed and never applied on its own. The address
          is spelled out because it is often NOT the one on the file: the robot
          writes from one mailbox and the humans from another. */}
      {offerRule && sender && !ruleSet && (
        <div className="rounded-lg border border-[var(--ink-4)] bg-[var(--ink-1)] p-2 text-left">
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
        //
        // And it carries its own undo, which the per-message marker already had
        // and this one did not — the wrong way round, since this is the gesture
        // that reaches messages nobody has read yet. Session-scoped: it undoes
        // the rule just accepted, which is when a mistake is noticed.
        // No margin of its own: the column above spaces its children with gap.
        <p role="status" className="wrap-anywhere text-right text-sky-300">
          Règle enregistrée : les prochains messages de {sender} arriveront marqués.{' '}
          <button
            type="button"
            disabled={busy}
            onClick={() => void ruleForSender(false)}
            className="cursor-pointer text-[var(--fg-3)] underline underline-offset-2 hover:text-[var(--fg-1)] disabled:cursor-default disabled:opacity-50"
          >
            retirer la règle
          </button>
        </p>
      )}

      {/* alert, not status: raised by something the operator just did. The
          endpoints ship from another platform than this page, so a 404 while
          the API catches up must say so here rather than break the file. */}
      {failed && (
        <p role="alert" className="text-right text-red-400">
          {failed}
        </p>
      )}
    </div>
  );
}
