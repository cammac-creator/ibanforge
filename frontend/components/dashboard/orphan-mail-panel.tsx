import { InfoDot } from './info-dot';

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

export function OrphanMailPanel({ orphans }: { orphans: OrphanMailRow[] }) {
  const pending = orphans.filter((o) => !o.resolved);
  // Replies are shown, first contacts are folded away behind a count.
  //
  // Measured on the first real run: fifteen unattached messages, of which one
  // was a customer waiting on an answer and the rest were release notices and
  // payout receipts. Showing all fifteen would bury the one that mattered, and a
  // panel that is mostly noise stops being read — the same failure as not having
  // one. A reply is somebody answering something we sent; that is the line worth
  // putting in front of the eye.
  const replies = pending.filter((o) => o.kind === 'reply');
  const others = pending.length - replies.length;

  // Nothing waiting is the normal state, and a panel that renders an empty box
  // every day trains the eye to skip the whole column.
  if (replies.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-500/40 bg-gradient-to-br from-amber-500/[0.07] to-[var(--ink-2)]/60 p-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="text-sm font-semibold text-white">Courrier à rattacher</h2>
        <p className="text-[13px] text-[var(--fg-3)]">
          <span className="font-semibold text-amber-400">
            {replies.length} réponse{replies.length > 1 ? 's' : ''} à un de nos fils
          </span>
          {others > 0 && (
            <span> · {others} premier{others > 1 ? 's' : ''} contact{others > 1 ? 's' : ''} en attente</span>
          )}
        </p>
        <InfoDot>
          Des mails qui parlent d&apos;IBANforge et que le CRM ne peut relier à personne, parce que
          l&apos;expéditeur n&apos;est ni un détenteur de clé ni un prospect connu. C&apos;est ce qui
          arrive quand un client répond depuis une autre adresse que celle de sa clé : sans ce
          panneau, le message n&apos;apparaît nulle part. « Réponse » veut dire qu&apos;il répond à
          quelque chose qu&apos;on a envoyé, donc que quelqu&apos;un attend. Les premiers contacts
          sont comptés mais pas listés : au premier relevé, quatorze des quinze messages étaient des
          avis de publication npm et des reçus Stripe, et les afficher aurait enterré le seul qui
          comptait.
        </InfoDot>
      </div>

      <ul className="divide-y divide-[var(--ink-4)]/50">
        {replies.map((o) => (
          <li key={o.id} className="py-2.5">
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
              <span className="ml-auto text-[12px] text-[var(--fg-4)]">{frDay(o.msg_date)}</span>
            </div>
            {o.subject && (
              <p className="mt-0.5 text-[12.5px] text-[var(--fg-3)]">{o.subject}</p>
            )}
            {o.snippet && (
              <p className="mt-0.5 line-clamp-2 text-[12px] text-[var(--fg-4)]">{o.snippet}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
