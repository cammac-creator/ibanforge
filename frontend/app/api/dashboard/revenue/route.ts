import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';

// Server-side proxy for the backend /admin/revenue endpoint. Keeps STATS_TOKEN
// on the server (never shipped to the browser) and is gated by the dashboard
// session cookie, so only a logged-in operator can read wallet data.
//
// Two modes:
//   ?mode=balance  → fast single eth_call (live USDC balance). Always quick.
//   ?mode=full     → full Transfer-log scan (transaction list). Slow on the
//                    public RPC (~20-30s); for a complete, fast history set
//                    BASE_RPC_URL on the backend to a dedicated endpoint.
const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const STATS_TOKEN = process.env.STATS_TOKEN || '';

// Wide enough to reach the early-rollout transfers that fund the current
// balance (they predate the 30-day default window).
const FULL_LOOKBACK_BLOCKS = 3_000_000;

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const mode = req.nextUrl.searchParams.get('mode') === 'full' ? 'full' : 'balance';
  const path =
    mode === 'balance'
      ? '/admin/revenue?balance_only=true'
      : `/admin/revenue?blocks=${FULL_LOOKBACK_BLOCKS}`;

  const headers: HeadersInit = STATS_TOKEN ? { Authorization: `Bearer ${STATS_TOKEN}` } : {};

  try {
    const res = await fetch(`${API_URL}${path}`, {
      cache: 'no-store',
      headers,
      // Balance is instant; the full scan can run long — give it room, but the
      // hosting platform may cap function duration (then the client shows a
      // graceful "history unavailable" state).
      signal: AbortSignal.timeout(mode === 'full' ? 55_000 : 12_000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: 'revenue_unavailable', detail: (err as Error).message },
      { status: 502 },
    );
  }
}
