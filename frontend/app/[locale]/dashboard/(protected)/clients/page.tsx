import { getLocale } from 'next-intl/server';
import { ClientsApp } from '@/components/crm/clients-app';
import { fetchCrmData } from '@/lib/crm/build-contacts';
import { buildDossiers, fetchClientProfiles } from '@/lib/crm/client-dossiers';

export const dynamic = 'force-dynamic';

export default async function ClientsPage() {
  const locale = await getLocale();
  const [data, profiles] = await Promise.all([fetchCrmData(), fetchClientProfiles(90)]);

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
    now: new Date(),
  });

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-[var(--fg-1)]">Clients</h1>
        <p className="mt-0.5 text-sm text-[var(--fg-4)]">
          Ce que chaque client fait réellement de l&apos;API. Cliquez une ligne pour ouvrir son dossier.
        </p>
      </header>
      <ClientsApp dossiers={dossiers} locale={locale} />
    </div>
  );
}
