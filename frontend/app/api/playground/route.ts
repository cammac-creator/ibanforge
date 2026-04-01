import { NextRequest, NextResponse } from 'next/server';

// API_URL: prefer server-side var, fallback to public var, then localhost
const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function POST(req: NextRequest) {
  const { type, value } = await req.json();

  let apiPath: string;
  let options: RequestInit;

  if (type === 'iban') {
    apiPath = '/v1/iban/validate';
    options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iban: value }),
    };
  } else if (type === 'bic') {
    apiPath = `/v1/bic/${encodeURIComponent(value)}`;
    options = { method: 'GET' };
  } else {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  }

  try {
    const url = `${API_URL}${apiPath}`;
    console.log(`[playground proxy] Fetching: ${url}`);
    const start = Date.now();
    const res = await fetch(url, options);
    const ms = Date.now() - start;
    const data = await res.json();
    return NextResponse.json({ ...data, _playground_ms: ms });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[playground proxy] Error fetching ${API_URL}${apiPath}:`, message);
    return NextResponse.json({ error: 'API unreachable', debug_url: API_URL, detail: message }, { status: 502 });
  }
}
