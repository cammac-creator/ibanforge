import { getLocale } from 'next-intl/server';
import { CrmApp } from '@/components/crm/crm-app';
import { StatCardV2 } from '@/components/dashboard/stat-card-v2';
import { TopUsersToday, type TopUserToday } from '@/components/dashboard/top-users-today';
import { enrichEmail } from '@/lib/company-enrichment';
import { isArchived } from '@/lib/crm/archived';
import { ballWithUs as isBallWithUs, followupDue as isFollowupDue } from '@/lib/crm/buckets';
import { buildContacts, fetchCrmData, INTERNAL_RE, type KeyRow } from '@/lib/crm/build-contacts';
import { countSentToday } from '@/lib/crm/sent-today';
import { situationOf } from '@/lib/crm/situation';
import type { Situation } from '@/lib/crm/types';

/** Ported as it stood from the Clients page: paid beats pilot beats free. */
function categoryOf(row: KeyRow): TopUserToday['category'] {
  if (row.credits_total != null) return 'PAYANT';
  if ((row.monthly_limit ?? 0) >= 5000) return 'PILOTE';
  return 'GRATUIT';
}

const CAT_RANK = { PAYANT: 0, PILOTE: 1, GRATUIT: 2 } as const;

/** Stripe pack price by credit bundle, as the Clients page had it. */
const BUNDLE_USD: Record<number, number> = { 1000: 5, 5000: 20, 25000: 80 };

/**
 * The top-3 hero card, lifted from the Clients page rather than rewritten:
 * requests attributed per client address, all of its keys combined, internal
 * accounts excluded, on the same UTC day convention as request_log. On a quiet
 * day it backfills with this month's most active clients (api_usage `used`),
 * which is where free-tier usage lives from before per-key daily attribution
 * existed, so the podium always shows real users.
 *
 * Everything it needs is already in the payload the page fetches; nothing was
 * added to the fetch for it.
 */
function topUsers(
  keys: KeyRow[],
  activityByKey: Record<string, { days: Array<{ day: string; count: number }> }>,
  todayUtc: string,
): TopUserToday[] {
  const collect = (
    map: Map<string, TopUserToday>,
    row: KeyRow,
    count: number,
    period: TopUserToday['period'],
  ) => {
    const category = categoryOf(row);
    const prev = map.get(row.email.toLowerCase());
    if (prev) {
      prev.count += count;
      if (CAT_RANK[category] < CAT_RANK[prev.category]) prev.category = category;
    } else {
      const enriched = enrichEmail(row.email);
      map.set(row.email.toLowerCase(), {
        email: row.email,
        company: enriched.company,
        sector: enriched.sector,
        category,
        count,
        period,
      });
    }
  };

  const todayByEmail = new Map<string, TopUserToday>();
  for (const row of keys) {
    if (INTERNAL_RE.test(row.email)) continue;
    const count = activityByKey[row.key_prefix]?.days.find((d) => d.day === todayUtc)?.count ?? 0;
    if (count > 0) collect(todayByEmail, row, count, 'today');
  }
  const top = [...todayByEmail.values()].sort((a, b) => b.count - a.count).slice(0, 3);

  if (top.length < 3) {
    const monthByEmail = new Map<string, TopUserToday>();
    for (const row of keys) {
      if (INTERNAL_RE.test(row.email)) continue;
      if (todayByEmail.has(row.email.toLowerCase())) continue;
      if (row.used > 0) collect(monthByEmail, row, row.used, 'month');
    }
    const monthly = [...monthByEmail.values()].sort((a, b) => b.count - a.count);
    top.push(...monthly.slice(0, 3 - top.length));
  }
  return top;
}

/**
 * The single CRM page: clients and prospects in one list, one vocabulary, one
 * detail pane. Replaces the two near-twin pages that each had their own list,
 * filters, search and thread.
 */
export default async function ContactsPage() {
  const locale = await getLocale();
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

  // Same instant as the situations above, so the whole page is one snapshot.
  const todayUtc = now.toISOString().slice(0, 10);
  const top = topUsers(data.keys, data.activityByKey, todayUtc);

  // Same instant again. Counted over the raw messages rather than over the
  // contacts, so a mail sent to an address buildContacts drops (an internal
  // one, or a key it treats as an evaluation pilot) still counts against the
  // day. That errs towards a slightly high number, which is the harmless
  // direction for a figure whose only job is to say when to stop sending.
  const sentToday = countSentToday(data.messages, now);

  // Every counter below reads the active contacts, never the raw list, so a
  // card can never advertise a number the matching filter chip refuses to
  // show. The two day buckets go one step further and call the very predicates
  // the chips and the day rail call, so the same figure appears in three
  // places or in none.
  const active = contacts.filter((c) => !isArchived(c, situations[c.id]));
  const ballWithUs = contacts.filter((c) => isBallWithUs(c, situations[c.id])).length;
  const followupDue = contacts.filter((c) => isFollowupDue(c, situations[c.id])).length;
  const prospects = active.filter((c) => c.kind === 'prospect').length;
  const clients = active.filter((c) => c.kind === 'client').length;

  // Ported as they stood from the Clients page. The overview's money card is
  // x402 USDC, which cannot be attributed per client; this one is the Stripe
  // pack revenue, and the two are complementary rather than duplicates.
  let revenueUsd = 0;
  let freeActive = 0;
  for (const c of active) {
    if (c.kind !== 'client') continue;
    if (c.apiKey.paid && c.apiKey.creditsTotal != null) {
      revenueUsd += BUNDLE_USD[c.apiKey.creditsTotal] ?? 0;
    } else if (!c.apiKey.paid && c.apiKey.usedAllTime > 0) {
      freeActive += 1;
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-white">Contacts</h1>
        <p className="mt-1 text-sm text-[var(--fg-3)]">
          {active.length} contact{active.length > 1 ? 's' : ''} suivi
          {active.length > 1 ? 's' : ''}
        </p>
      </div>

      <TopUsersToday top={top} todayUtc={todayUtc} locale={locale} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCardV2
          title="Revenu clients"
          value={`$${revenueUsd}`}
          accentColor="#22c55e"
          hint="CA réel des payants (packs Stripe). x402 non attribuable par client."
        />
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
          title="Gratuits actifs"
          value={String(freeActive)}
          accentColor="#eab308"
          hint="Clés gratuites qui appellent réellement l’API, candidats à la conversion."
        />
        <StatCardV2
          title="Prospects"
          value={String(prospects)}
          accentColor="#14b8a6"
          hint="Contacts sans clé API."
        />
        <StatCardV2
          title="Clients"
          value={String(clients)}
          accentColor="#a855f7"
          hint="Contacts qui ont une clé API."
        />
      </div>

      <CrmApp contacts={contacts} situations={situations} sentToday={sentToday} />
    </div>
  );
}
