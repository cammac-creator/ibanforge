import { CrmApp } from '@/components/crm/crm-app';
import { StatCardV2 } from '@/components/dashboard/stat-card-v2';
import { buildContacts, fetchCrmData } from '@/lib/crm/build-contacts';
import { situationOf } from '@/lib/crm/situation';
import type { Situation } from '@/lib/crm/types';

/**
 * The single CRM page: clients and prospects in one list, one vocabulary, one
 * detail pane. Replaces the two near-twin pages that each had their own list,
 * filters, search and thread.
 */
export default async function ContactsPage() {
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

  const contacts = buildContacts(data);

  // Derived here, on the server, and handed down as data. Two reasons, both
  // load-bearing:
  //   1. situationOf reads the current instant, and it parses msg_date, which
  //      is stored without a timezone, so new Date() reads it as local time. A
  //      UTC server and a browser in Europe/Zurich therefore place the same
  //      message two hours apart, and any thread whose silence boundary falls
  //      in that window yields a different silenceDays on each side. The list
  //      is server-rendered then hydrated, so that difference is a hydration
  //      mismatch, and it also flips followupDue, hence the filter counts, the
  //      default filter's membership and the sort order.
  //   2. One clock for the whole page. Thirty calls each taking their own
  //      new Date() could straddle midnight and disagree with each other.
  const now = new Date();
  const situations: Record<string, Situation> = {};
  for (const c of contacts) situations[c.id] = situationOf(c.messages, now);

  const all = Object.values(situations);
  const ballWithUs = all.filter((s) => s.ballInCourt === 'us').length;
  const followupDue = all.filter((s) => s.followupDue).length;
  const prospects = contacts.filter((c) => c.kind === 'prospect').length;
  const clients = contacts.filter((c) => c.kind === 'client').length;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-white">Contacts</h1>
        <p className="mt-1 text-sm text-[var(--fg-3)]">
          {contacts.length} contact{contacts.length > 1 ? 's' : ''} suivi
          {contacts.length > 1 ? 's' : ''}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCardV2
          title="Tu as la balle"
          value={String(ballWithUs)}
          accentColor="#3b82f6"
          hint="Fils dont le dernier message est entrant : ils attendent ta réponse."
        />
        <StatCardV2
          title="Relances dues"
          value={String(followupDue)}
          accentColor="#f59e0b"
          hint="Plus de 10 jours sans réponse depuis ton dernier mail."
        />
        <StatCardV2
          title="Prospects"
          value={String(prospects)}
          accentColor="#22c55e"
          hint="Contacts sans clé API."
        />
        <StatCardV2
          title="Clients"
          value={String(clients)}
          accentColor="#a855f7"
          hint="Contacts qui ont une clé API."
        />
      </div>

      <CrmApp contacts={contacts} situations={situations} />
    </div>
  );
}
