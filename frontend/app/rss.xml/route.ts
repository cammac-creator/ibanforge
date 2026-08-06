import { buildRss } from '@/lib/feed';

export const dynamic = 'force-static';

export async function GET() {
  return new Response(buildRss(), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
