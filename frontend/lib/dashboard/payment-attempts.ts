export interface PaymentAttempts {
  total_attempted_usdc: number;
  days: Array<{ date: string; attempted_usdc: number }>;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const amount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 &&
  value * 1_000_000 <= Number.MAX_SAFE_INTEGER;
function day(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value;
}

/** Une autre monnaie, une période trouée ou un encaissement ne devient pas une tentative USDC. */
export function readPaymentAttempts(value: unknown): PaymentAttempts | null {
  if (!object(value) || value.version !== 1 || value.source !== 'daily_stats' ||
    value.currency !== 'USDC' || value.basis !== 'verified_payment_attempts' ||
    value.settlement !== 'not_reconciled' || value.total_since !== '2026-04-18' ||
    !amount(value.total_attempted_usdc) || typeof value.read_at !== 'string') return null;
  const stamp = Date.parse(value.read_at);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString() !== value.read_at) return null;
  const window = value.window;
  if (!object(window) || window.days !== 7 || window.time_zone !== 'UTC' ||
    !day(window.from) || !day(window.to) || window.to !== value.read_at.slice(0, 10) ||
    Date.parse(window.to) - Date.parse(window.from) !== 6 * 86_400_000 ||
    !Array.isArray(value.days) || value.days.length !== 7) return null;
  const days: PaymentAttempts['days'] = [];
  for (let index = 0; index < value.days.length; index++) {
    const row: unknown = value.days[index];
    const expected = new Date(Date.parse(window.from) + index * 86_400_000).toISOString().slice(0, 10);
    if (!object(row) || row.date !== expected || !amount(row.attempted_usdc)) return null;
    days.push({ date: expected, attempted_usdc: row.attempted_usdc });
  }
  if (window.from >= value.total_since &&
    days.reduce((sum, row) => sum + row.attempted_usdc, 0) > value.total_attempted_usdc + 0.000007) return null;
  return { total_attempted_usdc: value.total_attempted_usdc, days };
}
