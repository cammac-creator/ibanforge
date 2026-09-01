import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { clientsHref, contactsHref } from '@/lib/crm/deep-link';

/**
 * The two gestures a cockpit row is allowed to offer (ENS-16).
 *
 * The overview named work and gave no way to do it: dozens of follow-ups due,
 * customers named in an amber banner, and not one button anywhere. These two
 * links close that, and they are LINKS on purpose — nothing is ever sent from
 * the overview. "Ouvrir" lands on the client's dossier in the Clients tab,
 * "Écrire" lands on the thread in Contacts with the composer at hand. The
 * decision to send still happens where the whole file is on screen.
 *
 * Both hrefs come from lib/crm/deep-link.ts, which is the contract the two
 * receiving pages read, so a rename there cannot leave these buttons pointing
 * at nothing.
 */
export async function ClientLinks({
  locale,
  email,
  canWrite = true,
}: {
  locale: string;
  email: string;
  /**
   * Whether the Contacts page can actually open this address.
   *
   * buildContacts drops a key that never called, carries no mail thread and
   * signed up more than NEW_SIGNUP_DAYS ago — which is most of the queue's
   * "never called" bucket. The link would land on Contacts with an empty pane
   * and say nothing about why, so it is not offered.
   */
  canWrite?: boolean;
}) {
  const t = await getTranslations('dashboard.overview');
  const style =
    'rounded border border-[var(--ink-5)] px-1.5 py-0.5 text-[11px] text-[var(--fg-4)] transition-colors hover:border-[var(--fg-4)] hover:text-[var(--fg-1)]';
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Link href={clientsHref(locale, email)} className={style} prefetch={false}>
        {t('actions.open')}
      </Link>
      {canWrite && (
        <Link href={contactsHref(locale, email)} className={style} prefetch={false}>
          {t('actions.write')}
        </Link>
      )}
    </span>
  );
}
