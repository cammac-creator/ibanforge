import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

/**
 * The ⌘K palette's thin index: one row per person, label + email + kind.
 * Built from the two light admin lists (keys, prospects), never from the
 * full CRM payload — the palette must answer the first keypress instantly.
 */
export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!API_URL || !ADMIN_SECRET) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  const headers = { 'X-Admin-Secret': ADMIN_SECRET };
  try {
    const [keysRes, prospectsRes] = await Promise.all([
      fetch(`${API_URL}/v1/admin/keys`, { headers, signal: AbortSignal.timeout(8000) }),
      fetch(`${API_URL}/v1/admin/prospects`, { headers, signal: AbortSignal.timeout(8000) }).catch(() => null),
    ]);
    const rows = new Map<string, { email: string; label: string; kind: 'client' | 'prospect' }>();
    if (keysRes.ok) {
      const keys = (((await keysRes.json()) as { keys?: Array<{ email?: string }> }).keys ?? []);
      for (const k of keys) {
        const email = (k.email ?? '').trim().toLowerCase();
        if (!email.includes('@') || email.endsWith('@example.com')) continue;
        rows.set(email, { email, label: email.split('@')[1] ?? email, kind: 'client' });
      }
    }
    if (prospectsRes?.ok) {
      const prospects = (((await prospectsRes.json()) as {
        prospects?: Array<{ contact_email?: string; company?: string }>;
      }).prospects ?? []);
      for (const p of prospects) {
        const email = (p.contact_email ?? '').trim().toLowerCase();
        if (!email.includes('@')) continue;
        const existing = rows.get(email);
        const label = p.company?.trim() || email.split('@')[1] || email;
        if (existing) existing.label = label;
        else rows.set(email, { email, label, kind: 'prospect' });
      }
    }
    return NextResponse.json({ rows: [...rows.values()].sort((a, b) => a.label.localeCompare(b.label)) });
  } catch {
    return NextResponse.json({ error: 'upstream_failed' }, { status: 502 });
  }
}
