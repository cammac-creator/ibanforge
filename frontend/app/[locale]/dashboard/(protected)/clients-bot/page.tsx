import { requireDashboardSession } from '@/lib/auth';
import { getLocale } from 'next-intl/server';
import { BotsApp, type BridgeClient } from '@/components/crm/bots-app';
import { buildBots, fetchBotProfiles, groupBots } from '@/lib/crm/bot-dossiers';
import { fetchCrmData, lateReadsSummary, type CrmPart } from '@/lib/crm/build-contacts';
import { LateReadsBanner } from '@/components/crm/late-reads';
import {
  buildDossiers,
  fetchClientProfiles,
  fetchCompanyProfiles,
} from '@/lib/crm/client-dossiers';
import { localePath } from '@/lib/locale-path';

export const dynamic = 'force-dynamic';

/**
 * The identified customers, reduced to what the agent bridge needs.
 *
 * Wrapped in its own try/catch and resolving to an empty list on any failure:
 * the crossing into the Clients tab is an enrichment, and an enrichment must
 * never be able to take down the page it enriches. Without it the page renders
 * exactly as it did before the bridge existed.
 *
 * C24: the reads the deadline cut (keys or prospects) come back with the
 * clients, and the page names them with the banner of the other CRM pages.
 * Without the prospects, a client crossing over has no company name; the page
 * still draws itself (the bridge is an enrichment), but no longer silently.
 */
async function loadBridgeClients(): Promise<{ clients: BridgeClient[]; late: CrmPart[] }> {
  let late: CrmPart[] = [];
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
    late = data?.late ?? [];
    if (!data || !profiles.readable) return { clients: [], late };
    const dossiers = buildDossiers({
      keys: data.keys,
      prospects: data.prospects,
      messages: data.messages,
      profiles: profiles.profiles,
      monthsByKey: profiles.monthsByKey,
      quotaWarnedByKey: profiles.quotaWarnedByKey,
      companyProfiles,
      now: new Date(profiles.generatedAt!),
      windowDays: 90,
      activation: data.activation,
    });
    const clients = dossiers
      .filter((d) => d.userAgents.length > 0)
      .map((d) => ({ id: d.id, email: d.email, company: d.company, userAgents: d.userAgents }));
    return { clients, late };
  } catch {
    return { clients: [], late };
  }
}

export default async function ClientsBotPage() {
  await requireDashboardSession();
  // Twenty, not five: the agents between the two account for a tiny share of
  // the traffic and are almost all one-off visitors. It is also the floor the
  // `perdu` and `sonde` verdicts need before a ratio means anything.
  // The widest window the selector offers, fetched once: the card narrows to
  // 7 or 30 days in the browser, so the switch costs nothing here.
  const [locale, profiles, bridge] = await Promise.all([
    getLocale(),
    fetchBotProfiles(90, 20),
    loadBridgeClients(),
  ]);
  // Always the banner, never the panel: the robots below do not depend on the
  // late read, only the crossing into the Clients tab does.
  const lateReads = lateReadsSummary(bridge.late);
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
          Tout ce qui nous appelle sans clé : annuaires d&apos;agents, registres MCP, sondes x402,
          contrôles de disponibilité. Un dossier par robot — cliquez une ligne pour ouvrir le sien.
        </p>
      </header>
      {/* The day-by-day curve moved to the overview (owner's call, 04/09/2026):
          it is the whole API's question, not the robots' alone. */}
      <p className="text-[12.5px] text-[var(--fg-4)]">
        La courbe du trafic jour par jour est sur la{' '}
        <a
          href={localePath(locale, '/dashboard')}
          className="underline decoration-dotted underline-offset-2 hover:text-[var(--fg-1)]"
        >
          Vue d&apos;ensemble
        </a>
        , section 2.
      </p>

      {lateReads && <LateReadsBanner summary={lateReads} />}

      {bots.length === 0 ? (
        <div className="rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 p-8 text-center">
          <p className="font-medium text-[var(--fg-2)]">Aucun agent au-dessus du seuil</p>
          <p className="mt-1 text-sm text-[var(--fg-3)]">
            Clé du site (SITE_ADMIN_TOKEN) absente ou refusée, API injoignable, ou vraiment personne sur les 90 derniers
            jours.
          </p>
        </div>
      ) : (
        <BotsApp bots={bots} clients={bridge.clients} locale={locale} />
      )}
    </div>
  );
}
