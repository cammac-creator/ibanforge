import { buildAtom } from '@/lib/feed';

export const dynamic = 'force-static';

export async function GET() {
  return new Response(buildAtom(), {
    headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' },
  });
}
