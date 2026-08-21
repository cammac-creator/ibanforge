import { getLocale } from 'next-intl/server';
import { BotsApp, type BridgeClient } from '@/components/crm/bots-app';
import { buildBots, fetchBotProfiles } from '@/lib/crm/bot-dossiers';
import { fetchCrmData } from '@/lib/crm/build-contacts';
import { buildDossiers, fetchClientProfiles, fetchCompanyProfiles } from '@/lib/crm/client-dossiers';

export const dynamic = 'force-dynamic';

/**
 * The identified customers, reduced to what the agent bridge needs.
 *
 * Wrapped in its own try/catch and resolving to an empty list on any failure:
 * the crossing into the Clients tab is an enrichment, and an enrichment must
 * never be able to take down the page it enriches. Without it the page renders
 * exactly as it did before the bridge existed.
 */
async function loadBridgeClients(): Promise<BridgeClient[]> {
  try {
    const [data, profiles, companyProfiles] = await Promise.all([
      fetchCrmData(),
      fetchClientProfiles(90),
      fetchCompanyProfiles(),
    ]);
    if (!data) return [];
    const dossiers = buildDossiers({
      keys: data.keys,
      prospects: data.prospects,
      messages: data.messages,
      profiles: profiles.profiles,
      monthsByKey: profiles.monthsByKey,
      quotaWarnedByKey: profiles.quotaWarnedByKey,
      companyProfiles,
      now: new Date(),
      windowDays: 90,
      activation: data.activation,
    });
    return dossiers
      .filter((d) => d.userAgents.length > 0)
      .map((d) => ({ id: d.id, email: d.email, company: d.company, userAgents: d.userAgents }));
  } catch {
    return [];
  }
}

export default async function ClientsBotPage() {
  // Twenty, not five: the 231 agents between the two account for 1.4 % of the
  // traffic and are almost all one-off visitors. It is also the floor the
  // `perdu` and `sonde` verdicts need before a ratio means anything.
  const [locale, profiles, clients] = await Promise.all([
    getLocale(),
    fetchBotProfiles(90, 20),
    loadBridgeClients(),
  ]);
  const bots = buildBots(profiles, new Date());

  if (bots.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 p-8 text-center">
        <p className="font-medium text-[var(--fg-2)]">Aucun agent au-dessus du seuil</p>
        <p className="mt-1 text-sm text-[var(--fg-3)]">
          ADMIN_SECRET non configuré, API injoignable, ou vraiment personne sur les 90 derniers jours.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-[var(--fg-1)]">Clients Bot</h1>
        <p className="mt-0.5 text-sm text-[var(--fg-4)]">
          Tout ce qui nous appelle sans clé : annuaires d&apos;agents, registres MCP, sondes x402, contrôles de
          disponibilité. Cliquez une ligne pour ouvrir son dossier.
        </p>
      </header>
      <BotsApp bots={bots} clients={clients} locale={locale} />
    </div>
  );
}
