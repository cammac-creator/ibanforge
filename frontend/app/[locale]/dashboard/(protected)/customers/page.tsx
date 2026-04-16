import { getTranslations, getLocale } from 'next-intl/server';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

interface KeyRow {
  key_prefix: string;
  email: string;
  monthly_limit: number | null;
  active: number;
  created_at: string;
  used: number;
}

interface KeysResponse {
  month: string;
  keys: KeyRow[];
}

async function fetchKeys(): Promise<KeysResponse | null> {
  if (!ADMIN_SECRET) return null;
  try {
    const res = await fetch(`${API_URL}/v1/admin/keys`, {
      cache: 'no-store',
      headers: { 'X-Admin-Secret': ADMIN_SECRET },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function daysSince(isoDate: string): number {
  const then = new Date(isoDate).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

function classify(row: KeyRow): { label: string; color: string; bg: string } {
  const limit = row.monthly_limit ?? 200;
  const isPilot = limit > 200;
  const isSilent = row.used === 0;
  const isAtRisk = limit > 0 && row.used / limit >= 0.8;
  const created = daysSince(row.created_at);

  if (!row.active) return { label: 'inactive', color: '#71717a', bg: '#27272a' };
  if (isPilot && isSilent && created >= 3) return { label: 'silent', color: '#f59e0b', bg: '#451a03' };
  if (isPilot && isSilent) return { label: 'pending', color: '#a78bfa', bg: '#2e1065' };
  if (isAtRisk) return { label: 'at-risk', color: '#ef4444', bg: '#450a0a' };
  if (row.used > 0) return { label: 'active', color: '#22c55e', bg: '#052e16' };
  return { label: 'unused', color: '#71717a', bg: '#27272a' };
}

function isPilotEmail(email: string): boolean {
  return email.includes('-pilot@') || email.includes('pilot-');
}

export default async function CustomersPage() {
  const t = await getTranslations('dashboard.customers');
  const locale = await getLocale();
  const data = await fetchKeys();

  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-8 text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
            <span className="text-red-400 text-xl">!</span>
          </div>
          <p className="text-zinc-300 font-medium">{t('error.title')}</p>
          <p className="text-sm text-zinc-500 mt-1">{t('error.description')}</p>
        </div>
      </div>
    );
  }

  const keys = [...data.keys].sort((a, b) => {
    const aLimit = a.monthly_limit ?? 200;
    const bLimit = b.monthly_limit ?? 200;
    if (aLimit !== bLimit) return bLimit - aLimit;
    return b.used - a.used;
  });

  const pilots = keys.filter((k) => (k.monthly_limit ?? 200) > 200);
  const silentPilots = pilots.filter((k) => k.used === 0 && daysSince(k.created_at) >= 3);
  const activePilots = pilots.filter((k) => k.used > 0);
  const totalPilots = pilots.length;
  const freeTier = keys.filter((k) => (k.monthly_limit ?? 200) <= 200);
  const freeTierActive = freeTier.filter((k) => k.used > 0).length;

  return (
    <div className="flex flex-col gap-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">{t('stats.totalPilots')}</p>
          <p className="mt-1 text-2xl font-semibold text-white">{totalPilots}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {activePilots.length} {t('stats.active')}, {silentPilots.length} {t('stats.silent')}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">{t('stats.freeTier')}</p>
          <p className="mt-1 text-2xl font-semibold text-white">{freeTier.length}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {freeTierActive} {t('stats.used')}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">{t('stats.silentAlert')}</p>
          <p className="mt-1 text-2xl font-semibold text-amber-400">{silentPilots.length}</p>
          <p className="mt-1 text-xs text-zinc-500">{t('stats.silentAlertDescription')}</p>
        </div>

        <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">{t('stats.month')}</p>
          <p className="mt-1 text-2xl font-semibold text-white">{data.month}</p>
          <p className="mt-1 text-xs text-zinc-500">{t('stats.monthDescription')}</p>
        </div>
      </div>

      {/* Silent pilots alert */}
      {silentPilots.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm font-medium text-amber-300 mb-2">⚠ {t('silentSection.title')}</p>
          <p className="text-xs text-amber-200/70 mb-3">{t('silentSection.description')}</p>
          <ul className="space-y-1">
            {silentPilots.map((k) => (
              <li key={k.key_prefix} className="text-xs text-amber-200">
                <span className="font-mono text-amber-400">{k.key_prefix}</span> — {k.email}{' '}
                <span className="text-amber-500/60">
                  ({daysSince(k.created_at)}d {t('silentSection.agoWithoutUse')})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Pilots table */}
      <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
        <p className="mb-4 text-sm font-medium text-zinc-300">{t('pilotsSection.title')}</p>
        {pilots.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-zinc-500 text-sm">
            {t('pilotsSection.empty')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500 uppercase tracking-wide">
                  <th className="pb-2 font-medium">{t('table.customer')}</th>
                  <th className="pb-2 font-medium">{t('table.created')}</th>
                  <th className="pb-2 font-medium">{t('table.usage')}</th>
                  <th className="pb-2 font-medium">{t('table.status')}</th>
                </tr>
              </thead>
              <tbody>
                {pilots.map((k) => {
                  const limit = k.monthly_limit ?? 200;
                  const pct = limit > 0 ? Math.round((k.used / limit) * 100) : 0;
                  const status = classify(k);
                  const days = daysSince(k.created_at);
                  return (
                    <tr key={k.key_prefix} className="border-b border-zinc-800/50 last:border-0">
                      <td className="py-3">
                        <div className="flex flex-col">
                          <span className="text-zinc-200 truncate max-w-[280px]">{k.email}</span>
                          <span className="font-mono text-[10px] text-zinc-600">{k.key_prefix}</span>
                        </div>
                      </td>
                      <td className="py-3 text-zinc-400">
                        <span className="text-xs">
                          {new Date(k.created_at).toLocaleDateString(locale)}{' '}
                          <span className="text-zinc-600">
                            ({days}d {t('table.ago')})
                          </span>
                        </span>
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-xs text-zinc-300 w-24">
                            {k.used.toLocaleString(locale)} / {limit.toLocaleString(locale)}
                          </span>
                          <div className="flex-1 max-w-[120px] h-1.5 rounded-full bg-zinc-800/60 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: status.color }}
                            />
                          </div>
                          <span className="text-xs font-mono text-zinc-500 w-10 text-right">{pct}%</span>
                        </div>
                      </td>
                      <td className="py-3">
                        <span
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                          style={{ color: status.color, backgroundColor: status.bg }}
                        >
                          {t(`status.${status.label}` as Parameters<typeof t>[0])}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Free tier — only active */}
      {freeTier.some((k) => k.used > 0) && (
        <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
          <p className="mb-4 text-sm font-medium text-zinc-300">
            {t('freeTierSection.title')} ({freeTierActive})
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500 uppercase tracking-wide">
                  <th className="pb-2 font-medium">{t('table.customer')}</th>
                  <th className="pb-2 font-medium">{t('table.created')}</th>
                  <th className="pb-2 font-medium">{t('table.usage')}</th>
                  <th className="pb-2 font-medium">{t('table.type')}</th>
                </tr>
              </thead>
              <tbody>
                {freeTier
                  .filter((k) => k.used > 0)
                  .map((k) => {
                    const limit = k.monthly_limit ?? 200;
                    const pct = limit > 0 ? Math.round((k.used / limit) * 100) : 0;
                    const days = daysSince(k.created_at);
                    const isInternal = k.email.endsWith('@ibanforge.com') || k.email.includes('@example.com');
                    return (
                      <tr key={k.key_prefix} className="border-b border-zinc-800/50 last:border-0">
                        <td className="py-3">
                          <div className="flex flex-col">
                            <span className="text-zinc-300 truncate max-w-[280px]">{k.email}</span>
                            <span className="font-mono text-[10px] text-zinc-600">{k.key_prefix}</span>
                          </div>
                        </td>
                        <td className="py-3 text-xs text-zinc-500">
                          {new Date(k.created_at).toLocaleDateString(locale)} ({days}d)
                        </td>
                        <td className="py-3">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-xs text-zinc-400 w-20">
                              {k.used} / {limit}
                            </span>
                            <div className="flex-1 max-w-[120px] h-1.5 rounded-full bg-zinc-800/60 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-zinc-500/60"
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-3">
                          <span
                            className={`text-[10px] uppercase tracking-wide ${isInternal ? 'text-zinc-600' : 'text-zinc-400'}`}
                          >
                            {isInternal ? t('type.internal') : isPilotEmail(k.email) ? t('type.pilot') : t('type.free')}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
