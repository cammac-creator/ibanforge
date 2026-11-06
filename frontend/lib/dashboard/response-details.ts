import type { StatusByPathRow } from '@/components/dashboard/status-by-path-table';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Un détail incomplet ou incohérent ne transforme pas les compteurs de classe en zéros. */
export function readResponseDetails(row: StatusByPathRow, kind: 'status' | 'method'): Array<[string, number]> | null {
  const value: unknown = kind === 'status' ? row.by_status : row.by_method;
  if (!object(value)) return null;
  const pairs = Object.entries(value);
  const pattern = kind === 'status' ? /^[1-5][0-9]{2}$/ : /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,32}$/;
  if (!pairs.every(([key, n]) => pattern.test(key) && count(n) && n <= row.total)) return null;
  const entries = pairs as Array<[string, number]>;
  if (entries.reduce((sum, [, n]) => sum + n, 0) !== row.total) return null;
  if (kind === 'status' && !([2, 3, 4, 5] as const).every(group =>
    entries.filter(([code]) => Number(code[0]) === group).reduce((sum, [, n]) => sum + n, 0) === row[`s${group}xx`])) return null;
  return entries.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** Catégorie descriptive, sans prix ni quota recopié dans le tableau de bord. */
export function responsePathFamily(path: string): string {
  if (path === '/mcp') return 'mcp';
  if (path === '/health' || path === '/ping') return 'health';
  if (path === '/stats' || path.startsWith('/stats/')) return 'statistics';
  if (path.startsWith('/v1/iban/')) return 'iban';
  if (path.startsWith('/v1/bic/')) return 'bic';
  if (path.startsWith('/v1/ch/clearing/')) return 'clearing';
  if (path.startsWith('/v1/keys/')) return 'keys';
  if (path.startsWith('/v1/admin/')) return 'admin';
  return 'recorded';
}
