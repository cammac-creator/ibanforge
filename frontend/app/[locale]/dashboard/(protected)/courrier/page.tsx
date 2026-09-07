import { JournalApp } from '@/components/crm/journal-app';
import { FreshnessBadge } from '@/components/crm/freshness-badge';
import { buildContacts, fetchCrmData } from '@/lib/crm/build-contacts';
import { journalRows, unattachedCount } from '@/lib/crm/journal';

/**
 * Courrier: the whole mailbox as one antichronological list.
 *
 * Contacts is where a conversation is answered; this is where the operator
 * checks what happened. The two are not the same need, and the second had no
 * screen: since part of the mail leaves without a click — the agent writes to
 * the authorities from his mailbox through the dashboard's relay, and each send
 * lands in email_messages as an ordinary 'out' row — every one of those letters
 * was visible only inside the fiche of the correspondent it was written to.
 * Which is to say: findable by somebody who already suspected it was there.
 *
 * The FULL mail payload, not the `fields=summary` cut, even though this page
 * draws the snippet and never the body. Every message of every contact is
 * flattened here, so the light cut would be the natural read; it is left for a
 * measured pass rather than assumed, since `fetchCrmData()`'s default is what
 * Contacts already downloads on the very same session.
 */
export default async function CourrierPage() {
  const data = await fetchCrmData();

  if (!data) {
    return (
      <div className="rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 p-8 text-center">
        <p className="font-medium text-[var(--fg-2)]">Données indisponibles</p>
        <p className="mt-1 text-sm text-[var(--fg-3)]">
          ADMIN_SECRET non configuré, ou API injoignable.
        </p>
      </div>
    );
  }

  /**
   * `buildContacts` and not `crmSnapshot`: this page reads MESSAGES, not the
   * state of a relationship. Situations, snoozes, the funnel and the money are
   * every one of them derivations about contacts, and none of them says
   * anything about what left the mailbox on Tuesday. Archived contacts keep
   * their lines for exactly the same reason — the gesture set a dossier aside,
   * it did not unsend its mail.
   */
  const contacts = buildContacts(data);
  const rows = journalRows(contacts);

  /**
   * The day, decided once, here.
   *
   * 🚨 Never in the component below. It filters again in the browser after
   * hydration, and an `Intl` call there would read the reader's own zone: the
   * period boundary and the « aujourd'hui » shelf would land on different days
   * on the two sides of that boundary. Same reason, same call, as the Contacts
   * page beside it.
   */
  const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(
    new Date(),
  );

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h1 className="text-base font-semibold text-white">Courrier</h1>
        <p className="text-sm text-[var(--fg-3)]">
          Tout ce qui est parti et arrivé, du plus récent au plus ancien. Une ligne mène au fil du
          contact.
        </p>
        <span className="ml-auto">
          <FreshnessBadge fetchedAtIso={new Date().toISOString()} />
        </span>
      </div>

      <JournalApp
        rows={rows}
        todayIso={todayIso}
        unattached={unattachedCount(data.messages, contacts)}
      />
    </div>
  );
}
