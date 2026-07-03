import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { isAuthenticated } from '@/lib/auth';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

/**
 * CRM-native drafts: one draft per client, stored as an email_messages row
 * with direction 'draft'. The id is derived from the client email alone, so
 * saving again overwrites the previous draft (upsert) instead of piling up.
 */
function draftId(email: string): string {
  return `draft-${createHash('md5').update(email.trim().toLowerCase()).digest('hex')}`;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!API_URL || !ADMIN_SECRET) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }
  let body: { email?: string; subject?: string; body?: string; account?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body.email || !body.subject) {
    return NextResponse.json({ error: 'invalid_body', message: 'email et subject requis' }, { status: 400 });
  }
  const text = body.body ?? '';
  const msg = {
    id: draftId(body.email),
    customer_email: body.email,
    direction: 'draft',
    msg_date: new Date().toISOString().slice(0, 16),
    subject: body.subject,
    snippet: text.replace(/\s+/g, ' ').trim().slice(0, 280),
    body: text.slice(0, 6000),
    counterparty: body.account ?? '',
  };
  try {
    const r = await fetch(`${API_URL}/v1/admin/email-messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
      body: JSON.stringify({ messages: [msg] }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await r.json().catch(() => ({ error: 'bad_upstream_response' }));
    return NextResponse.json(r.ok ? { saved: true, id: msg.id, ...data } : data, { status: r.status });
  } catch {
    return NextResponse.json({ error: 'upstream_failed' }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!API_URL || !ADMIN_SECRET) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }
  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body.id) {
    return NextResponse.json({ error: 'invalid_body', message: 'id requis' }, { status: 400 });
  }
  try {
    const r = await fetch(`${API_URL}/v1/admin/email-messages/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
      body: JSON.stringify({ id: body.id }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await r.json().catch(() => ({ error: 'bad_upstream_response' }));
    return NextResponse.json(data, { status: r.status });
  } catch {
    return NextResponse.json({ error: 'upstream_failed' }, { status: 502 });
  }
}
