import { getLocale } from 'next-intl/server';
import { StatCardV2 } from '@/components/dashboard/stat-card-v2';
import { enrichEmail } from '@/lib/company-enrichment';
import { CrmWorkspace, type CrmClient, type CrmMessage } from '@/components/dashboard/crm-workspace';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const BUNDLE_USD: Record<number, number> = { 1000: 5, 5000: 20, 25000: 80 };

interface KeyRow {
  key_prefix: string;
  email: string;
  monthly_limit: number | null;
  active: number;
  created_at: string;
  used: number;
  used_prev: number;
  used_all_time: number;
  last_active_month: string | null;
  credits_total: number | null;
  credits_remaining: number | null;
  paid: number;
  series: number[];
}
interface KeysResponse {
  month: string;
  prev_month: string;
  months?: string[];
  keys: KeyRow[];
}
interface MessageRow extends CrmMessage {
  customer_email: string;
}
interface ActivityRow {
  endpoints: Array<{ path: string; count: number }>;
  days: Array<{ day: string; count: number }>;
}

type Category = 'PAYANT' | 'PILOTE' | 'GRATUIT' | 'INTERNE';

const INTERNAL_RE =
  /(@ibanforge\.com|@example\.com|@test\.|test-|-test|smoke|audit|^ca-[a-z]+-?\d*@proton\.me|^credits-buyer$|^stripe-buyer$|^playground|cammac@bluewin\.ch|cam@ogens\.ch|ptibootch@|gpt-store@)/i;

function classify(row: KeyRow, isInternal: boolean): Category {
  if (isInternal) return 'INTERNE';
  if (row.credits_total != null) return 'PAYANT';
  if ((row.monthly_limit ?? 0) >= 5000) return 'PILOTE';
  return 'GRATUIT';
}

function statusOf(messages: CrmMessage[]): CrmClient['status'] {
  if (!messages.length) return 'not_contacted';
  const last = messages[messages.length - 1];
  if (last.direction === 'in') return 'replied';
  const d = last.msg_date ? Math.floor((Date.now() - new Date(last.msg_date).getTime()) / 86_400_000) : 0;
  return d > 5 ? 'followup_due' : 'awaiting';
}

export default async function CustomersPage() {
  const locale = await getLocale();
  const fmt = (n: number) => n.toLocaleString(locale);

  let data: KeysResponse | null = null;
  let messageRows: MessageRow[] = [];
  let activityByKey: Record<string, ActivityRow> = {};
  if (ADMIN_SECRET) {
    const h = { headers: { 'X-Admin-Secret': ADMIN_SECRET }, cache: 'no-store' as const };
    const [k, m, a] = await Promise.all([
      fetch(`${API_URL}/v1/admin/keys`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`${API_URL}/v1/admin/email-messages`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`${API_URL}/v1/admin/client-activity`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    data = k as KeysResponse | null;
    messageRows = (m?.messages ?? []) as MessageRow[];
    activityByKey = (a?.by_key ?? {}) as Record<string, ActivityRow>;
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-8 text-center">
        <p className="font-medium text-zinc-300">Données clients indisponibles</p>
        <p className="mt-1 text-sm text-zinc-500">ADMIN_SECRET non configuré, ou API injoignable.</p>
      </div>
    );
  }

  const threadsByEmail = new Map<string, CrmMessage[]>();
  for (const m of messageRows) {
    const key = m.customer_email.toLowerCase();
    const arr = threadsByEmail.get(key);
    if (arr) arr.push(m);
    else threadsByEmail.set(key, [m]);
  }

  // Build the CRM client list (paying + active free + anyone with email exchanges).
  const clients: CrmClient[] = [];
  let revenue = 0;
  let withMail = 0;
  let freeActive = 0;
  let toRelance = 0;

  for (const row of data.keys) {
    const isInternal = INTERNAL_RE.test(row.email);
    if (isInternal) continue;
    const category = classify(row, isInternal);
    if (category === 'PILOTE') continue; // pilots hidden (no real usage)

    const company = enrichEmail(row.email);
    const isPaid = row.credits_total != null;
    const messages = threadsByEmail.get(row.email.toLowerCase()) ?? [];
    const meaningful = isPaid || row.used_all_time > 0 || messages.length > 0;
    if (!meaningful) continue;

    const limit = row.monthly_limit ?? 200;
    const consumed = isPaid ? (row.credits_total ?? 0) - (row.credits_remaining ?? 0) : row.used_all_time;
    const consumedPct = isPaid
      ? row.credits_total
        ? (1 - (row.credits_remaining ?? 0) / row.credits_total) * 100
        : null
      : limit > 0
        ? (row.used / limit) * 100
        : null;
    const activated = isPaid ? consumed > 0 : row.used_all_time > 0;
    const revenueUsd = isPaid && row.credits_total != null ? (BUNDLE_USD[row.credits_total] ?? null) : null;

    let trend: 'up' | 'down' | 'flat' = 'flat';
    if (!isPaid && row.used_prev > 0) {
      const d = (row.used - row.used_prev) / row.used_prev;
      trend = d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'flat';
    } else if (!isPaid && row.used_prev === 0 && row.used > 0) trend = 'up';

    const nowMonth = new Date().toISOString().slice(0, 7);
    let health = isPaid ? 30 : category === 'GRATUIT' ? 6 : 0;
    health += activated ? 30 : 0;
    health += trend === 'up' ? 25 : trend === 'flat' ? 13 : 0;
    health += row.last_active_month === nowMonth ? 15 : row.last_active_month ? 7 : 0;
    health = Math.min(100, health);

    const status = statusOf(messages);
    let action = 'Sain — laisser tourner';
    if (isPaid && consumed === 0) action = 'Onboarder — a payé mais n’utilise pas';
    else if (isPaid && consumedPct != null && consumedPct > 80) action = 'Upsell — propose un pack supérieur';
    else if (isPaid && consumedPct != null && consumedPct < 10) action = 'Suivi — a payé mais usage faible, garde le lien';
    else if (status === 'followup_due') action = 'Relance due — sans réponse depuis ton dernier mail';
    else if (status === 'replied') action = 'A répondu — à toi de jouer';
    else if (category === 'GRATUIT' && consumedPct != null && consumedPct >= 80) action = 'Proposer un bundle payant';
    else if (trend === 'down') action = 'Relance anti-churn — usage en chute';
    else if (!activated) action = 'Onboarding — inscrit non activé';

    // Compose helpers
    const warm = messages.length > 0;
    const activeUser = !warm && row.used_all_time > 0; // uses the API, never emailed
    const account = warm ? 'cammac@bluewin.ch' : 'claude-alain@ibanforge.com';
    const lastSubj = messages.length ? messages[messages.length - 1].subject : null;
    const subject = warm && lastSubj
      ? lastSubj
      : activeUser
        ? 'Quick question from the IBANforge founder'
        : `IBANforge${company.company ? ' — ' + company.company : ''}`;
    const threadTxt = messages
      .slice(-4)
      .map((m) => `[${m.direction === 'in' ? 'them' : 'me'} ${m.msg_date ?? ''}] ${m.subject ?? ''}: ${m.snippet ?? ''}`)
      .join('\n');
    const goal = warm
      ? `Recent thread (them = client, me = founder):\n${threadTxt}\nContinue this conversation toward: ${action}.`
      : activeUser
        ? 'This person ALREADY uses IBANforge (they have made real API calls) but you have NEVER emailed them. Write a SHORT, warm, NON-salesy note from the founder: thank them for using it, then ask just two easy questions — (1) a brief bit of feedback on their experience so far, and (2) how they discovered IBANforge. Do NOT pitch features and do NOT ask for a call.'
        : 'No prior emails and no API usage yet — COLD first-touch: a short, credible pitch + one low-friction ask.';
    const brief = [
      `Client: ${company.company ?? row.email} <${row.email}>`,
      company.sector ? `Sector: ${company.sector}` : '',
      `Category: ${category}. Recommended next action: ${action}`,
      goal,
      row.email.includes('customer-n.example') ? 'IMPORTANT: never mention "Customer N" anywhere.' : '',
    ]
      .filter(Boolean)
      .join('\n');

    const lastMsgDate = messages.length ? messages[messages.length - 1].msg_date : null;
    const lastTouch = lastMsgDate ? lastMsgDate.slice(0, 10) : row.last_active_month;

    clients.push({
      email: row.email,
      key_prefix: row.key_prefix,
      company: company.company,
      sector: company.sector,
      website: company.website,
      country: company.country,
      category,
      revenueUsd,
      health,
      action,
      consumed,
      limit,
      consumedPct,
      creditsTotal: row.credits_total,
      status,
      lastTouch,
      account,
      subject,
      brief,
      messages,
      series: row.series ?? [],
      lastActive: row.last_active_month,
      endpoints: activityByKey[row.key_prefix]?.endpoints ?? [],
    });

    if (revenueUsd) revenue += revenueUsd;
    if (messages.length) withMail += 1;
    if (category === 'GRATUIT' && row.used_all_time > 0) freeActive += 1;
    if (status === 'followup_due' || (consumedPct ?? 0) >= 80) toRelance += 1;
  }

  // Priority sort: payants → relance due → awaiting → others; then by health desc.
  const order: Record<CrmClient['status'], number> = { followup_due: 0, replied: 1, awaiting: 2, not_contacted: 3 };
  clients.sort((a, b) => {
    if ((b.revenueUsd ?? 0) !== (a.revenueUsd ?? 0)) return (b.revenueUsd ?? 0) - (a.revenueUsd ?? 0);
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return b.health - a.health;
  });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-white">Clients — CRM</h1>
        <p className="mt-1 text-sm text-zinc-500">{clients.length} clients suivis · sélectionne à gauche pour voir le fil et agir</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCardV2 title="Revenu clients" value={`$${revenue}`} accentColor="#22c55e" hint="CA réel des payants (packs Stripe). x402 non attribuable par client." />
        <StatCardV2 title="Échanges mails" value={String(withMail)} accentColor="#3b82f6" hint="Clients avec qui tu as une conversation en cours." />
        <StatCardV2 title="Gratuits actifs" value={String(freeActive)} accentColor="#a855f7" hint="Clés gratuites qui appellent réellement l’API — candidats conversion." />
        <StatCardV2 title="À relancer" value={String(toRelance)} accentColor="#f59e0b" hint="Relances dues (sans réponse) + gratuits à ≥80% du quota." />
      </div>

      <CrmWorkspace clients={clients} />
      <p className="text-[11px] text-zinc-600">{fmt(data.keys.length)} clés au total · pilotes sans usage + internes/tests masqués.</p>
    </div>
  );
}
