import { NextResponse } from 'next/server';

// Freshness relay for the village plaques (/live): reduces the public
// /health payload to the per-source last_updated map — dates only, nothing
// else from the ops surface passes through. Cached ten minutes: freshness
// moves once a month (BIC rebuild) or once a week (sanctions).
const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface SourceRow { source?: unknown; last_updated?: unknown; stale?: unknown }

export async function GET() {
  try {
    const res = await fetch(`${API_URL}/health`, { next: { revalidate: 600 } });
    const data = (await res.json()) as { bic_sources?: SourceRow[]; bic_data_last_updated?: unknown };
    const sources: Record<string, string> = {};
    let anyStale = false;
    for (const row of Array.isArray(data.bic_sources) ? data.bic_sources : []) {
      if (typeof row.source === 'string' && typeof row.last_updated === 'string') {
        sources[row.source] = row.last_updated;
      }
      if (row.stale === true) anyStale = true;
    }
    return NextResponse.json({
      sources,
      overall: typeof data.bic_data_last_updated === 'string' ? data.bic_data_last_updated : null,
      anyStale,
    });
  } catch {
    return NextResponse.json({ sources: {}, overall: null, anyStale: false }, { status: 502 });
  }
}
