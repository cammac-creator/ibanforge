import { toZurich } from '@/lib/crm/zurich';
import type { MinorByCurrency, StripeRevenueSnapshot } from './stripe-revenue';

/** Série existante de Stripe : les remboursements restent rattachés au paiement d’origine. */
export interface SalesDay {
  count: number;
  gross: MinorByCurrency;
  refunded: MinorByCurrency;
  fees: MinorByCurrency;
  net_unknown: number;
}
export interface SalesPeriod extends SalesDay {
  start: string;
  end: string;
  days: Array<SalesDay & { day: string; partial: boolean }>;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
function minorMap(v: unknown, signed = false): v is MinorByCurrency {
  return object(v) && Object.entries(v).every(([c, n]) => /^[a-z]{3}$/.test(c)
    && typeof n === 'number' && Number.isSafeInteger(n) && (signed || n >= 0));
}
function calendarDay(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const ms = Date.parse(`${v}T12:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === v;
}
function emptyDay(): SalesDay { return { count: 0, gross: {}, refunded: {}, fees: {}, net_unknown: 0 }; }
function add(target: SalesDay, source: SalesDay): void {
  target.count += source.count;
  target.net_unknown += source.net_unknown;
  for (const field of ['gross', 'refunded', 'fees'] as const) {
    for (const [c, n] of Object.entries(source[field])) target[field][c] = (target[field][c] ?? 0) + n;
  }
}
function sameMap(a: MinorByCurrency, b: MinorByCurrency): boolean {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((c) => (a[c] ?? 0) === (b[c] ?? 0));
}

/** Une série absente/incohérente n’efface pas les cumuls Stripe valides. */
export function readSalesDays(snapshot: StripeRevenueSnapshot): Record<string, SalesDay> | null {
  const raw = snapshot.ibanforge_days;
  if (!object(raw)) return null;
  const lastDay = toZurich(snapshot.read_at).slice(0, 10);
  const sum = emptyDay();
  for (const [day, v] of Object.entries(raw)) {
    if (!calendarDay(day) || day > lastDay || !object(v) || !count(v.count) || !count(v.net_unknown)
      || v.net_unknown > v.count || !minorMap(v.gross) || !minorMap(v.refunded) || !minorMap(v.fees, true)) return null;
    const row = v as unknown as SalesDay;
    if (Object.entries(row.refunded).some(([c, n]) => n > (row.gross[c] ?? 0))) return null;
    add(sum, row);
  }
  const total = snapshot.ibanforge;
  if (sum.count !== total.count || sum.net_unknown !== total.net_unknown
    || !sameMap(sum.gross, total.gross) || !sameMap(sum.refunded, total.refunded) || !sameMap(sum.fees, total.fees)) return null;
  return raw as unknown as Record<string, SalesDay>;
}

/** N dates civiles suisses, bornées par la lecture Stripe ; jamais l’horloge du navigateur. */
export function salesPeriod(days: Record<string, SalesDay>, readAt: string, length: 7 | 30 | 90): SalesPeriod {
  const end = toZurich(readAt).slice(0, 10);
  const endMs = Date.parse(`${end}T12:00:00Z`);
  const result: SalesPeriod = { ...emptyDay(), start: '', end, days: [] };
  for (let i = length - 1; i >= 0; i--) {
    const day = new Date(endMs - i * 86_400_000).toISOString().slice(0, 10);
    const row = days[day] ?? emptyDay();
    add(result, row);
    result.days.push({ ...row, day, partial: i === 0 });
  }
  result.start = result.days[0].day;
  return result;
}
