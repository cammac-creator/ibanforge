import { NextResponse } from 'next/server';

// Live-traffic relay for /live — same server-side pattern as
// app/api/playground/route.ts, minus the key: /v1/ops/recent is free.
// Exists so the browser talks to its own origin (no CORS coupling), and
// never caches: a stale feed would replay couriers the viewer already saw.
const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function GET(req: Request) {
  const afterRaw = new URL(req.url).searchParams.get('after');
  const after = afterRaw && /^\d+$/.test(afterRaw) ? afterRaw : null;
  try {
    const res = await fetch(`${API_URL}/v1/ops/recent${after ? `?after=${after}` : ''}`, {
      cache: 'no-store',
    });
    const data = (await res.json()) as unknown;
    return NextResponse.json(data, {
      status: res.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ ops: [] }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
