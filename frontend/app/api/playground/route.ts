import { NextRequest, NextResponse } from 'next/server';

// API_URL: prefer server-side var, fallback to public var, then localhost
const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
// Internal API key for playground (server-side only, never exposed to client)
const PLAYGROUND_API_KEY = process.env.PLAYGROUND_API_KEY || '';

export async function POST(req: NextRequest) {
  const { type, value } = await req.json();

  let apiPath: string;
  let fetchOptions: RequestInit;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (PLAYGROUND_API_KEY) {
    headers['Authorization'] = `Bearer ${PLAYGROUND_API_KEY}`;
  }

  if (type === 'iban') {
    apiPath = '/v1/iban/validate';
    fetchOptions = {
      method: 'POST',
      headers,
      body: JSON.stringify({ iban: value }),
    };
  } else if (type === 'compliance') {
    apiPath = '/v1/iban/compliance';
    fetchOptions = {
      method: 'POST',
      headers,
      body: JSON.stringify({ iban: value }),
    };
  } else if (type === 'bic') {
    apiPath = `/v1/bic/${encodeURIComponent(value)}`;
    fetchOptions = { method: 'GET', headers };
  } else if (type === 'clearing') {
    apiPath = `/v1/ch/clearing/${encodeURIComponent(value)}`;
    fetchOptions = { method: 'GET', headers };
  } else {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  }

  try {
    const url = `${API_URL}${apiPath}`;
    const start = Date.now();
    const res = await fetch(url, fetchOptions);
    const ms = Date.now() - start;
    const data = await res.json();

    // A 402 here means OUR server-side key was absent, revoked or out of
    // quota — never something the visitor can fix. Serve a translatable code
    // (the page maps it), and put the diagnosis where it belongs: the logs.
    // This exact failure once surfaced as a raw English sentence on the FR
    // page, with nothing anywhere saying whether the key was dead or missing.
    if (res.status === 402) {
      console.error(
        `[playground] 402 from ${apiPath} — key ${PLAYGROUND_API_KEY ? 'set' : 'MISSING'}` +
          `${res.headers.get('X-API-Key-Invalid') === 'true' ? ', REJECTED as invalid (revoked?)' : ''}` +
          `${res.headers.get('X-Quota-Remaining') === '0' ? ', quota exhausted' : ''}`,
      );
      return NextResponse.json({
        error: 'playground_unavailable',
        _playground_ms: ms,
      });
    }

    return NextResponse.json({ ...data, _playground_ms: ms });
  } catch {
    return NextResponse.json({ error: 'API unreachable' }, { status: 502 });
  }
}
