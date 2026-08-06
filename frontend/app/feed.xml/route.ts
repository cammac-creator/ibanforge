import { buildRss } from '@/lib/feed';

// Alias: feed.xml is the second-most requested feed path after rss.xml.
export const dynamic = 'force-static';

export async function GET() {
  return new Response(buildRss(), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
