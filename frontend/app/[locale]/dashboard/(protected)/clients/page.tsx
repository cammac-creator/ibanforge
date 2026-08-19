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
  const locale = await getLocale();
  const params = await searchParams;
  const daysParam = Number(params.days ?? 90);
  const windowDays = (WINDOWS as readonly number[]).includes(daysParam) ? daysParam : 90;
  const [data, profiles, companyProfiles] = await Promise.all([
    fetchCrmData(),
    fetchClientProfiles(windowDays),
    fetchCompanyProfiles(),
  ]);

  if (!data) {
    return (
      <div className="rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 p-8 text-center">
        <p className="font-medium text-[var(--fg-2)]">Données indisponibles</p>
        <p className="mt-1 text-sm text-[var(--fg-3)]">ADMIN_SECRET non configuré, ou API injoignable.</p>
      </div>
    );
  }

  // One clock for the whole page, read on the server. Freshness and the verdict
  // both depend on "now", and the page is server-rendered then hydrated: two
  // clocks would mean the browser could disagree with the HTML it was sent.
  const dossiers = buildDossiers({
    keys: data.keys,
    prospects: data.prospects,
    messages: data.messages,
    profiles: profiles.profiles,
    monthsByKey: profiles.monthsByKey,
    quotaWarnedByKey: profiles.quotaWarnedByKey,
    companyProfiles,
    now: new Date(),
    windowDays,
    activation: data.activation,
  });

  return (
    <div className="space-y-5">
      <header>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-xl font-semibold text-[var(--fg-1)]">Clients</h1>
          <span className="ml-auto">
            <FreshnessBadge fetchedAtIso={new Date().toISOString()} />
          </span>
        </div>
        <p className="mt-0.5 text-sm text-[var(--fg-4)]">
          Ce que chaque client fait réellement de l&apos;API. Cliquez une ligne pour ouvrir son dossier.
        </p>
        <nav className="mt-2 flex items-center gap-1.5 text-[13px]">
          <span className="text-[var(--fg-5)]">Fenêtre :</span>
          {WINDOWS.map((w) => (
            <a
              key={w}
              href={`?days=${w}`}
              className={`rounded-full px-2.5 py-0.5 ${
                w === windowDays
                  ? 'bg-[var(--ink-5)] font-semibold text-white'
                  : 'text-[var(--fg-4)] hover:text-[var(--fg-2)]'
              }`}
            >
              {w} j
            </a>
          ))}
        </nav>
      </header>
      <ClientsApp dossiers={dossiers} locale={locale} windowDays={windowDays} />
    </div>
  );
}
