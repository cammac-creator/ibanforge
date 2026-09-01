import { getLocale } from 'next-intl/server';
import { BotsApp, type BridgeClient } from '@/components/crm/bots-app';
import { TrafficTrendCard } from '@/components/dashboard/traffic-trend-card';
import { buildBots, fetchBotProfiles, groupBots } from '@/lib/crm/bot-dossiers';
import { fetchCrmData } from '@/lib/crm/build-contacts';
import { buildDossiers, fetchClientProfiles, fetchCompanyProfiles } from '@/lib/crm/client-dossiers';
import { fetchTrafficTrend } from '@/lib/traffic-trend';

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
    // Four fields are read off the result: id, email, company, user agents.
    // The bridge used to pull the entire admin base for them, mail bodies
    // included (audit TABS-06, 2026-09-01). Prospects stay because they carry
    // the company names; everything else is dropped, mails first.
    const [data, profiles, companyProfiles] = await Promise.all([
      fetchCrmData({ skip: ['messages', 'activity', 'reads', 'activation', 'institutions'] }),
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
  // The widest window the selector offers, fetched once: the card narrows to
  // 7 or 30 days in the browser, so the switch costs nothing here.
  const [locale, profiles, clients, trend] = await Promise.all([
    getLocale(),
    fetchBotProfiles(90, 20),
    loadBridgeClients(),
    fetchTrafficTrend(90),
  ]);
  // Grouped before the browser ever sees them (audit TABS-05 and TABS-14): one
  // line per product with the versions kept as detail, and a single line for
  // every generic browser and scanner.
  const now = new Date();
  const bots = groupBots(buildBots(profiles, now), now);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-[var(--fg-1)]">Clients Bot</h1>
        <p className="mt-0.5 text-sm text-[var(--fg-4)]">
          Tout ce qui nous appelle sans clé : annuaires d&apos;agents, registres MCP, sondes x402, contrôles de
          disponibilité. La courbe d&apos;ensemble d&apos;abord, les dossiers ensuite — cliquez une ligne pour
          ouvrir le sien.
        </p>
      </header>

      {/* Above the dossiers, and no longer behind the emptiness test below:
          the trend runs on STATS_TOKEN while the dossiers run on ADMIN_SECRET,
          so a missing secret used to blank a chart that had everything it
          needed to draw itself. */}
      <TrafficTrendCard result={trend} />

      {bots.length === 0 ? (
        <div className="rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 p-8 text-center">
          <p className="font-medium text-[var(--fg-2)]">Aucun agent au-dessus du seuil</p>
          <p className="mt-1 text-sm text-[var(--fg-3)]">
            ADMIN_SECRET non configuré, API injoignable, ou vraiment personne sur les 90 derniers jours.
          </p>
        </div>
      ) : (
        <BotsApp bots={bots} clients={clients} locale={locale} />
      )}
    </div>
  );
}
