import { requireDashboardSession } from '@/lib/auth';
import { getLocale } from 'next-intl/server';
import { ClientsApp } from '@/components/crm/clients-app';
import { FreshnessBadge } from '@/components/crm/freshness-badge';
import { fetchCrmData } from '@/lib/crm/build-contacts';
import { buildDossiers, fetchClientProfiles, fetchCompanyProfiles } from '@/lib/crm/client-dossiers';

export const dynamic = 'force-dynamic';

const WINDOWS = [30, 90, 365] as const;

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireDashboardSession();
  const locale = await getLocale();
  const params = await searchParams;
  const daysParam = Number(params.days ?? 90);
  const windowDays = (WINDOWS as readonly number[]).includes(daysParam) ? daysParam : 90;
  // Only what buildDossiers reads (audit TABS-12, 2026-09-01). This page counts
  // mails and shows the last subject; it never renders a body, and it uses
  // neither the per-key activity, nor the thread reads, nor the institutional
  // contacts. Asking for all of it made every render carry the whole mailbox,
  // bodies included, and again after each gesture through router.refresh().
  const [data, profiles, companyProfiles] = await Promise.all([
    fetchCrmData({ lightMessages: true, skip: ['activity', 'reads', 'institutions'] }),
    fetchClientProfiles(windowDays),
    fetchCompanyProfiles(),
  ]);

  if (!data) {
    return (
      <div className="rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 p-8 text-center">
        <p className="font-medium text-[var(--fg-2)]">Données indisponibles</p>
        <p className="mt-1 text-sm text-[var(--fg-3)]">Clé du site (SITE_ADMIN_TOKEN) absente ou refusée, ou API injoignable.</p>
      </div>
    );
  }

  // One clock for the whole page, read on the server. Freshness and the verdict
  // both depend on "now", and the page is server-rendered then hydrated: two
  // clocks would mean the browser could disagree with the HTML it was sent.
  const readAtIso = profiles.generatedAt ?? new Date().toISOString();
  const dossiers = buildDossiers({
    keys: data.keys,
    prospects: data.prospects,
    messages: data.messages,
    profiles: profiles.profiles,
    monthsByKey: profiles.monthsByKey,
    quotaWarnedByKey: profiles.quotaWarnedByKey,
    companyProfiles,
    now: new Date(readAtIso),
    windowDays,
    activation: data.activation,
  });

  return (
    <div className="space-y-5">
      <header>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--fg-1)]">Clients</h1>
          <span className="ml-auto">
            <FreshnessBadge fetchedAtIso={readAtIso} />
          </span>
        </div>
        <p className="mt-0.5 text-sm text-[var(--fg-4)]">
          Vos comptes API, leur activité et les points à suivre. Ouvrez un compte pour explorer ses indicateurs.
        </p>
        <nav className="mt-2 flex items-center gap-1.5 text-[13px]">
          <span className="text-[var(--fg-5)]">Période UTC :</span>
          {WINDOWS.map((w) => (
            <a
              key={w}
              aria-current={w === windowDays ? 'page' : undefined}
              href={`?days=${w}`}
              className={`inline-flex min-h-11 items-center rounded-full px-4 py-2 ${
                w === windowDays
                  ? 'bg-[var(--ink-5)] font-semibold text-[var(--fg-1)]'
                  : 'text-[var(--fg-4)] hover:text-[var(--fg-2)]'
              }`}
            >
              {w} j
            </a>
          ))}
        </nav>
      </header>
      <p className="text-xs leading-relaxed text-[var(--fg-4)]">
        {windowDays} journées UTC, aujourd’hui inclus et encore incomplet. Requêtes acceptées et refusées,
        dans les traces conservées. Les pays sont ceux des données contrôlées, pas la localisation des personnes.
      </p>
      <ClientsApp dossiers={dossiers} locale={locale} windowDays={windowDays} readAtIso={readAtIso} activityAvailable={profiles.readable} />
    </div>
  );
}
