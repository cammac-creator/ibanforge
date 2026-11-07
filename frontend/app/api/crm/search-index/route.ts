import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { withReadDeadline } from '@/lib/dashboard/read-deadline';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
type Row = { email: string; label: string; kind: 'client' | 'prospect' };
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const optionalText = (value: unknown) => value == null || typeof value === 'string';
const reply = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'private, no-store' },
});

/** Une source n’est lisible qu’après réception et validation de son corps entier. */
async function read(source: 'keys' | 'prospects'): Promise<Row[] | null> {
  try {
    return await withReadDeadline(async signal => {
      const response = await fetch(`${API_URL}/v1/admin/${source}`, {
        headers: { 'X-Admin-Secret': ADMIN_SECRET }, signal, cache: 'no-store',
      });
      if (!response.ok) return null;
      const data: unknown = await response.json();
      if (!record(data) || !Array.isArray(data[source])) return null;
      const rows: Row[] = [];
      for (const entry of data[source]) {
        if (!record(entry)) return null;
        const raw = source === 'keys' ? entry.email : entry.contact_email;
        if (!optionalText(raw) || (source === 'prospects' && !optionalText(entry.company))) return null;
        const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
        if (!email.includes('@') || (source === 'keys' && email.endsWith('@example.com'))) continue;
        const company = source === 'prospects' && typeof entry.company === 'string' ? entry.company.trim() : '';
        rows.push({ email, label: company || email.split('@')[1] || email, kind: source === 'keys' ? 'client' : 'prospect' });
      }
      return rows;
    }, 8000);
  } catch { return null; }
}

/** Index privé léger ; chaque source conserve son résultat si l’autre échoue. */
export async function GET() {
  if (!(await isAuthenticated())) return reply({ error: 'unauthorized' }, 401);
  if (!API_URL || !ADMIN_SECRET) return reply({ error: 'not_configured' }, 503);
  const [keys, prospects] = await Promise.all([read('keys'), read('prospects')]);
  if (keys === null && prospects === null) return reply({ error: 'upstream_failed' }, 502);
  const rows = new Map<string, Row>();
  for (const row of keys ?? []) rows.set(row.email, row);
  for (const row of prospects ?? []) {
    const existing = rows.get(row.email);
    if (existing) existing.label = row.label;
    else rows.set(row.email, row);
  }
  return reply({ rows: [...rows.values()].sort((a, b) => a.label.localeCompare(b.label)), partial: keys === null || prospects === null });
}
