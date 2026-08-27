import { InfoDot } from './info-dot';
import { AttachOrphanControl } from './attach-orphan';

/**
 * Mail about IBANforge from an address the CRM cannot attach to anyone.
 *
 * The sync only fetches threads for addresses it knows — key holders and
 * prospects — so a customer who answers from a different address than the one
 * his key is registered under simply disappears. It happened to a paying
 * customer: the reply arrived, the CRM stayed empty, and nothing anywhere said a
 * message had been set aside.
 *
 * This panel exists so that never happens quietly again. It does not guess who
 * the sender is; attaching a message to a customer is a human decision, and all
 * this does is make the decision possible.
 */
export interface OrphanMailRow {
  id: string;
  sender: string;
  subject: string | null;
  snippet: string | null;
  msg_date: string;
  kind: 'reply' | 'first_contact';
  resolved: 0 | 1;
  resolved_as: string | null;
}

function frDay(iso: string): string {
  const [date] = iso.split(' ');
  const [y, m, d] = (date ?? '').split('-');
  return y ? `${d}.${m}.${y.slice(2)}` : iso;
}

function daysWaiting(iso: string): number {
  const t = Date.parse(iso.replace(' ', 'T'));
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function OrphanRow({ o }: { o: OrphanMailRow }) {
  const age = daysWaiting(o.msg_date);
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            o.kind === 'reply' ? 'bg-amber-500/20 text-amber-300' : 'bg-[var(--ink-4)] text-[var(--fg-3)]'
          }`}
        >
          {o.kind === 'reply' ? 'Réponse' : 'Premier contact'}
        </span>
        <a
          href={`mailto:${o.sender}`}
          className="text-[13.5px] font-medium text-[var(--fg-1)] hover:text-amber-400"
        >
          {o.sender}
        </a>
        <span className="ml-auto text-[12px] text-[var(--fg-4)]">
          {frDay(o.msg_date)}
          {/* Four days is past "I'll get to it": from there the wait itself
              becomes the information. */}
          {age >= 4 && <span className="ml-1.5 font-semibold text-amber-400">· attend depuis {age} j</span>}
        </span>
      </div>
      {o.subject && <p className="mt-0.5 text-[12.5px] text-[var(--fg-3)]">{o.subject}</p>}
      {/* The snippet is all we hold of the message (the sync stores no body);
          clamping it hid the very words the decision needs. */}
      {o.snippet && <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--fg-4)]">{o.snippet}</p>}
      <AttachOrphanControl orphanId={o.id} sender={o.sender} />
    </li>
  );
}

export function OrphanMailPanel({ orphans, totalPending }: { orphans: OrphanMailRow[]; totalPending?: number }) {
  const pending = orphans.filter((o) => !o.resolved);
  // The API caps the list (oldest first server-side, so the cut falls on the
  // newest); `totalPending` is the uncapped count. When they differ, saying so
  // beats letting the header under-count in silence.
  const hidden = typeof totalPending === 'number' ? Math.max(0, totalPending - pending.length) : 0;
  // Replies are listed openly, first contacts are folded behind their count.
  //
  // Measured on the first real run: nearly every unattached message was an
  // automated notice — release notices, payout receipts — and exactly one was
  // a customer waiting on an answer. Showing them all would bury the one that
  // mattered, and a panel that is mostly noise stops being read — the same
  // failure as not having one. A reply is somebody answering something we
  // sent; that is the line worth putting in front of the eye. The fold means
  // the counted ones can still be triaged: a number with no handle only ever
  // grows.
  const replies = pending.filter((o) => o.kind === 'reply');
  const firstContacts = pending.filter((o) => o.kind !== 'reply');

  // A queue empties from its oldest end: the reply that has waited longest is
  // the one to deal with first, not the one that just arrived.
  const byOldest = (a: OrphanMailRow, b: OrphanMailRow) => a.msg_date.localeCompare(b.msg_date);
  replies.sort(byOldest);
  firstContacts.sort(byOldest);

  // Nothing waiting is the normal state, and a panel that renders an empty box
  // every day trains the eye to skip the whole column.
  if (pending.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-500/40 bg-gradient-to-br from-amber-500/[0.07] to-[var(--ink-2)]/60 p-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="text-sm font-semibold text-white">Courrier à rattacher</h2>
        <p className="text-[13px] text-[var(--fg-3)]">
          {replies.length > 0 && (
            <span className="font-semibold text-amber-400">
              {replies.length} réponse{replies.length > 1 ? 's' : ''} à un de nos fils
            </span>
          )}
          {replies.length > 0 && firstContacts.length > 0 && <span> · </span>}
          {firstContacts.length > 0 && (
            <span>
              {firstContacts.length} premier{firstContacts.length > 1 ? 's' : ''} contact
              {firstContacts.length > 1 ? 's' : ''} en attente
            </span>
          )}
          {hidden > 0 && <span> · {hidden} de plus au-delà de la limite d&apos;affichage</span>}
        </p>
        <InfoDot>
          Des mails qui parlent d&apos;IBANforge et que le CRM ne peut relier à personne, parce que
          l&apos;expéditeur n&apos;est ni un détenteur de clé ni un prospect connu. C&apos;est ce qui
          arrive quand un client répond depuis une autre adresse que celle de sa clé : sans ce
          panneau, le message n&apos;apparaît nulle part. « Réponse » veut dire qu&apos;il répond à
          quelque chose qu&apos;on a envoyé, donc que quelqu&apos;un attend. Deux issues par mail :
          le rattacher à un client (son fil complet remonte à la synchro suivante), ou le classer
          sans rattachement quand ce n&apos;est pas un client — une autorité qui répond à une de nos
          lettres, un avis automatique. Les premiers contacts sont pliés sous leur compteur : au
          premier relevé, presque tous étaient des avis automatiques (publications npm, reçus
          Stripe), et les afficher aurait enterré le seul qui comptait.
        </InfoDot>
      </div>

      {replies.length > 0 && (
        <ul className="divide-y divide-[var(--ink-4)]/50">
          {replies.map((o) => (
            <OrphanRow key={o.id} o={o} />
          ))}
        </ul>
      )}

      {firstContacts.length > 0 && (
        <details className={replies.length > 0 ? 'mt-3 border-t border-[var(--ink-4)]/50 pt-2' : ''}>
          <summary className="cursor-pointer select-none text-[12.5px] text-[var(--fg-3)] hover:text-[var(--fg-1)]">
            Déplier les {firstContacts.length} premier{firstContacts.length > 1 ? 's' : ''} contact
            {firstContacts.length > 1 ? 's' : ''} (surtout des avis automatiques)
          </summary>
          <ul className="divide-y divide-[var(--ink-4)]/50">
            {firstContacts.map((o) => (
              <OrphanRow key={o.id} o={o} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
