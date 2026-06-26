import { getLocale } from 'next-intl/server';
import { StatCardV2 } from '@/components/dashboard/stat-card-v2';
import { InfoDot } from '@/components/dashboard/info-dot';
import { enrichEmail, type CompanyInfo } from '@/lib/company-enrichment';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

// Stripe credit bundles → real $ paid (src/routes/stripe-webhook.ts).
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
}
interface KeysResponse {
  month: string;
  prev_month: string;
  keys: KeyRow[];
}

type Category = 'PAYANT' | 'PILOTE' | 'GRATUIT' | 'INTERNE';

interface Customer extends KeyRow {
  company: CompanyInfo;
  category: Category;
  isInternal: boolean;
  revenueUsd: number | null;
  consumedPct: number | null; // % of quota (free/pilot) or credits (paid)
  consumed: number; // calls/credits actually consumed
  limit: number;
  activated: boolean;
  trend: 'up' | 'down' | 'flat';
  trendPct: number | null;
  ageDays: number;
  health: number;
  action: string;
}

// Internal / automated-test accounts that must not pollute the real roster.
const INTERNAL_RE =
  /(@ibanforge\.com|@example\.com|@test\.|test-|-test|smoke|audit|^ca-[a-z]+-?\d*@proton\.me|^credits-buyer$|^stripe-buyer$|^playground|cammac@bluewin\.ch|gpt-store@)/i;

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function classify(row: KeyRow, isInternal: boolean): Category {
  if (isInternal) return 'INTERNE';
  if (row.credits_total != null) return 'PAYANT';
  if ((row.monthly_limit ?? 0) >= 5000) return 'PILOTE';
  return 'GRATUIT';
}

function buildCustomer(row: KeyRow): Customer {
  const isInternal = INTERNAL_RE.test(row.email);
  const category = classify(row, isInternal);
  const company = enrichEmail(row.email);
  const isPaid = row.credits_total != null;

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

  let trend: 'up' | 'down' | 'flat' = 'flat';
  let trendPct: number | null = null;
  if (!isPaid && row.used_prev > 0) {
    const d = Math.round(((row.used - row.used_prev) / row.used_prev) * 100);
    trendPct = d;
    trend = d > 5 ? 'up' : d < -5 ? 'down' : 'flat';
  } else if (!isPaid && row.used_prev === 0 && row.used > 0) {
    trend = 'up';
  }

  const ageDays = daysSince(row.created_at);
  const revenueUsd = isPaid && row.credits_total != null ? (BUNDLE_USD[row.credits_total] ?? null) : null;

  // Health 0-100: paiement 30 + activation 30 + tendance 25 + récence 15.
  const nowMonth = new Date().toISOString().slice(0, 7);
  let health = 0;
  health += isPaid ? 30 : category === 'PILOTE' ? 12 : category === 'GRATUIT' ? 6 : 0;
  health += activated ? 30 : 0;
  health += trend === 'up' ? 25 : trend === 'flat' ? 13 : 0;
  health += row.last_active_month === nowMonth ? 15 : row.last_active_month ? 7 : 0;
  health = Math.min(100, health);

  // Next best action (rules from the CRM spec).
  let action = '—';
  if (isInternal) action = 'Compte interne / test';
  else if (isPaid && consumed === 0) action = 'Onboarder — a payé mais n’utilise pas';
  else if (isPaid && consumedPct != null && consumedPct > 80) action = 'Upsell — propose un pack supérieur';
  else if (isPaid && consumedPct != null && consumedPct < 10) action = 'Suivi — a payé mais usage faible, garde le lien';
  else if (category === 'PILOTE' && row.used_all_time === 0 && ageDays >= 3) action = 'Relancer par mail — lead offert dormant';
  else if (category === 'GRATUIT' && consumedPct != null && consumedPct >= 80) action = 'Proposer un bundle payant';
  else if (trend === 'down') action = 'Relance anti-churn — usage en chute';
  else if (activated) action = 'Sain — laisser tourner';
  else action = 'Onboarding — inscrit non activé';

  return {
    ...row,
    company,
    category,
    isInternal,
    revenueUsd,
    consumedPct,
    consumed,
    limit,
    activated,
    trend,
    trendPct,
    ageDays,
    health,
    action,
  };
}

function healthColor(h: number): string {
  return h >= 80 ? '#22c55e' : h >= 40 ? '#f59e0b' : '#ef4444';
}

const CARD = 'rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5';

function CompanyCell({ c }: { c: Customer }) {
  return (
    <div className="flex flex-col">
      <span className="flex items-center gap-1.5 text-zinc-200">
        {c.company.website ? (
          <a href={c.company.website} target="_blank" rel="noreferrer" className="truncate max-w-[180px] hover:text-amber-400 hover:underline">
            {c.company.company ?? c.email}
          </a>
        ) : (
          <span className="truncate max-w-[180px]">{c.company.company ?? c.email}</span>
        )}
        {c.company.linkedin && (
          <a href={c.company.linkedin} target="_blank" rel="noreferrer" className="text-[10px] text-blue-400 hover:underline">
            in
          </a>
        )}
      </span>
      <span className="truncate max-w-[200px] text-[11px] text-zinc-500">{c.email}</span>
      {c.company.sector && <span className="text-[10px] text-zinc-600">{c.company.sector}{c.company.country ? ` · ${c.company.country}` : ''}</span>}
    </div>
  );
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await getLocale();
  const params = await searchParams;
  const showInternal = params.show === 'internal';
  const fmt = (n: number) => n.toLocaleString(locale);

  let data: KeysResponse | null = null;
  if (ADMIN_SECRET) {
    try {
      const res = await fetch(`${API_URL}/v1/admin/keys`, { cache: 'no-store', headers: { 'X-Admin-Secret': ADMIN_SECRET } });
      if (res.ok) data = (await res.json()) as KeysResponse;
    } catch {
      data = null;
    }
  }

  if (!data) {
    return (
      <div className={`${CARD} text-center`}>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
          <span className="text-xl text-red-400">!</span>
        </div>
        <p className="font-medium text-zinc-300">Données clients indisponibles</p>
        <p className="mt-1 text-sm text-zinc-500">ADMIN_SECRET non configuré côté serveur, ou API injoignable.</p>
      </div>
    );
  }

  const all = data.keys.map(buildCustomer);
  const real = all.filter((c) => !c.isInternal);
  const internalCount = all.length - real.length;

  const payants = real.filter((c) => c.category === 'PAYANT').sort((a, b) => (b.revenueUsd ?? 0) - (a.revenueUsd ?? 0));
  const pilotes = real.filter((c) => c.category === 'PILOTE').sort((a, b) => b.used_all_time - a.used_all_time);
  const gratuitsActifs = real.filter((c) => c.category === 'GRATUIT' && c.used_all_time > 0).sort((a, b) => b.used_all_time - a.used_all_time);
  const silentPilots = pilotes.filter((c) => c.used_all_time === 0 && c.ageDays >= 3);
  const totalRevenue = payants.reduce((s, c) => s + (c.revenueUsd ?? 0), 0);
  const toRelance = silentPilots.length + gratuitsActifs.filter((c) => (c.consumedPct ?? 0) >= 80).length;
  const internalRows = showInternal ? all.filter((c) => c.isInternal) : [];

  const th = 'pb-2 font-medium text-left';
  const headRow = 'border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500';

  return (
    <div className="flex flex-col gap-6">
      {/* Header + honest count */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-white">Clients — CRM</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {payants.length} payant{payants.length > 1 ? 's' : ''} · {pilotes.length} pilotes · {gratuitsActifs.length} gratuits actifs
            <span className="text-zinc-600"> · ~{internalCount} internes/tests masqués</span>
          </p>
        </div>
        <a
          href={showInternal ? '?' : '?show=internal'}
          className="rounded px-2.5 py-1 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-300"
        >
          {showInternal ? 'Masquer internes & tests' : 'Afficher internes & tests'}
        </a>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCardV2
          title="Revenu clients"
          value={`$${totalRevenue}`}
          accentColor="#22c55e"
          trend={{ direction: payants.length > 0 ? 'up' : 'neutral', label: `${payants.length} payant${payants.length > 1 ? 's' : ''}` }}
          hint="Somme du CA réel des clients payants (pack Stripe : 1k=$5, 5k=$20, 25k=$80). x402/USDC n'est pas attribuable par client. Interprétation : concentre ton énergie sur les plus hauts — ce sont eux qu'il ne faut pas perdre."
        />
        <StatCardV2
          title="Pilotes fintech"
          value={String(pilotes.length)}
          accentColor="#3b82f6"
          trend={{ direction: silentPilots.length > 0 ? 'down' : 'up', label: `${pilotes.length - silentPilots.length} actifs` }}
          hint="Clés à quota relevé (5000) offertes à des leads fintech. Interprétation : un pilote qui n'appelle jamais est un lead dormant — c'est gratuit pour lui, à toi de l'activer."
        />
        <StatCardV2
          title="Gratuits actifs"
          value={String(gratuitsActifs.length)}
          accentColor="#a855f7"
          hint="Clés gratuites (200/mois) qui ont réellement appelé l'API. Interprétation : un gros consommateur gratuit est ton meilleur candidat à l'upgrade payant."
        />
        <StatCardV2
          title="À relancer"
          value={String(toRelance)}
          accentColor="#f59e0b"
          trend={{ direction: toRelance > 0 ? 'down' : 'up', label: 'actions' }}
          hint="Pilotes silencieux (≥3 j sans appel) + gratuits à ≥80% de leur quota. Interprétation : c'est ta liste d'actions du jour — l'argent et l'activation les plus faciles."
        />
      </div>

      {/* Silent pilots alert */}
      {silentPilots.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="mb-1 text-sm font-medium text-amber-300">⚠ {silentPilots.length} pilotes silencieux à relancer</p>
          <p className="mb-3 text-xs text-amber-200/70">Leads fintech à qui tu as offert une clé 5000/mois mais qui n’ont jamais appelé l’API (≥ 3 jours). Un mail de relance ici = ton meilleur ROI.</p>
          <div className="flex flex-wrap gap-2">
            {silentPilots.map((c) => (
              <span key={c.key_prefix} className="rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
                {c.company.company ?? c.email} <span className="text-amber-500/60">· {c.ageDays}j</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* PAYANTS */}
      <div className={CARD}>
        <div className="mb-4 flex items-center gap-2">
          <p className="text-sm font-medium text-zinc-300">💚 Clients payants</p>
          <InfoDot>Clients qui ont acheté un pack de crédits (Stripe). Ce sont tes VIP : réponse prioritaire, ne les perds pas. Le revenu est exact (dérivé du pack acheté).</InfoDot>
        </div>
        {payants.length === 0 ? (
          <div className="flex h-20 items-center justify-center text-sm text-zinc-600">Aucun client payant pour l’instant.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={headRow}>
                  <th className={th}>Client</th>
                  <th className={th}>Revenu</th>
                  <th className={th}>Crédits consommés</th>
                  <th className={th}>Santé</th>
                  <th className={th}>Action recommandée</th>
                </tr>
              </thead>
              <tbody>
                {payants.map((c) => (
                  <tr key={c.key_prefix} className="border-b border-zinc-800/50 last:border-0">
                    <td className="py-3"><CompanyCell c={c} /></td>
                    <td className="py-3 font-mono text-green-400">{c.revenueUsd != null ? `$${c.revenueUsd}` : '—'}</td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-20 font-mono text-xs text-zinc-300">{fmt(c.consumed)} / {fmt(c.credits_total ?? 0)}</span>
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800/60">
                          <div className="h-full rounded-full bg-green-500/50" style={{ width: `${Math.min(c.consumedPct ?? 0, 100)}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="py-3">
                      <span className="font-mono text-xs font-semibold" style={{ color: healthColor(c.health) }}>{c.health}</span>
                    </td>
                    <td className="py-3 text-xs text-zinc-300">{c.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* PILOTES */}
      <div className={CARD}>
        <div className="mb-4 flex items-center gap-2">
          <p className="text-sm font-medium text-zinc-300">🔵 Pilotes (clés 5000 offertes)</p>
          <InfoDot>Leads fintech à qui tu as offert un quota relevé pour tester. « Quota relevé » est un proxy — ce n’est PAS un paiement. Objectif : les faire passer de dormants à actifs, puis payants.</InfoDot>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={headRow}>
                <th className={th}>Client</th>
                <th className={th}>Créé</th>
                <th className={th}>Appels (total)</th>
                <th className={th}>Activé</th>
                <th className={th}>Santé</th>
                <th className={th}>Action recommandée</th>
              </tr>
            </thead>
            <tbody>
              {pilotes.map((c) => (
                <tr key={c.key_prefix} className="border-b border-zinc-800/50 last:border-0">
                  <td className="py-3"><CompanyCell c={c} /></td>
                  <td className="py-3 text-xs text-zinc-400">{c.ageDays} j</td>
                  <td className="py-3 font-mono text-xs text-zinc-300">{fmt(c.used_all_time)}</td>
                  <td className="py-3">
                    <span className={`text-xs ${c.activated ? 'text-green-400' : 'text-red-400'}`}>{c.activated ? 'oui' : 'jamais'}</span>
                  </td>
                  <td className="py-3 font-mono text-xs font-semibold" style={{ color: healthColor(c.health) }}>{c.health}</td>
                  <td className="py-3 text-xs text-zinc-300">{c.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* GRATUITS ACTIFS */}
      <div className={CARD}>
        <div className="mb-4 flex items-center gap-2">
          <p className="text-sm font-medium text-zinc-300">🟣 Gratuits actifs (candidats conversion)</p>
          <InfoDot>Clés gratuites (200/mois) qui appellent réellement. Ceux proches de 100% du quota ont « faim » : c’est le moment de proposer un pack payant.</InfoDot>
        </div>
        {gratuitsActifs.length === 0 ? (
          <div className="flex h-20 items-center justify-center text-sm text-zinc-600">Aucun gratuit actif ce mois.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={headRow}>
                  <th className={th}>Client</th>
                  <th className={th}>Quota ce mois</th>
                  <th className={th}>Tendance</th>
                  <th className={th}>Santé</th>
                  <th className={th}>Action recommandée</th>
                </tr>
              </thead>
              <tbody>
                {gratuitsActifs.map((c) => {
                  const pct = c.limit > 0 ? Math.round((c.used / c.limit) * 100) : 0;
                  return (
                    <tr key={c.key_prefix} className="border-b border-zinc-800/50 last:border-0">
                      <td className="py-3"><CompanyCell c={c} /></td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-16 font-mono text-xs text-zinc-300">{c.used} / {c.limit}</span>
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800/60">
                            <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: pct >= 80 ? '#ef4444' : pct >= 50 ? '#f59e0b' : '#22c55e' }} />
                          </div>
                          <span className="font-mono text-[10px] text-zinc-500">{pct}%</span>
                        </div>
                      </td>
                      <td className="py-3 text-xs">
                        <span className={c.trend === 'up' ? 'text-green-400' : c.trend === 'down' ? 'text-red-400' : 'text-zinc-500'}>
                          {c.trend === 'up' ? '▲' : c.trend === 'down' ? '▼' : '='} {c.trendPct != null ? `${c.trendPct > 0 ? '+' : ''}${c.trendPct}%` : ''}
                        </span>
                      </td>
                      <td className="py-3 font-mono text-xs font-semibold" style={{ color: healthColor(c.health) }}>{c.health}</td>
                      <td className="py-3 text-xs text-zinc-300">{c.action}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Legend / how to read */}
      <div className={`${CARD} text-xs text-zinc-500`}>
        <p className="mb-2 font-medium text-zinc-400">Comment lire ce CRM</p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          <li><span className="text-green-400 font-semibold">Santé 80-100</span> = client sain, laisse-le tranquille.</li>
          <li><span className="text-amber-400 font-semibold">Santé 40-79</span> = à surveiller.</li>
          <li><span className="text-red-400 font-semibold">Santé &lt; 40</span> = agis maintenant (relance/onboarding).</li>
          <li>Score = paiement 30 + activation 30 + tendance 25 + récence 15.</li>
          <li><span className="text-zinc-300">Revenu</span> : exact pour Stripe ; x402/USDC non attribuable par client.</li>
          <li><span className="text-zinc-300">Société</span> : domaines connus vérifiés ; sinon dérivée du domaine (clique pour qualifier).</li>
        </ul>
      </div>

      {/* Internal / test (toggle) */}
      {showInternal && internalRows.length > 0 && (
        <div className={CARD}>
          <p className="mb-3 text-sm font-medium text-zinc-500">Internes & tests ({internalRows.length}) — exclus des compteurs</p>
          <div className="flex flex-wrap gap-1.5">
            {internalRows.map((c) => (
              <span key={c.key_prefix} className="rounded bg-zinc-800/50 px-2 py-0.5 text-[11px] text-zinc-500">{c.email}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
