import { robotsTxt } from "@/lib/robots";

export const dynamic = "force-static";

/**
 * /robots.txt, written here rather than by a robots.ts special file because
 * Next cannot write a Content-Signal line (frontend/lib/robots.ts). Same cache
 * header as the special file served: robots re-read it on every visit.
 */
export function GET() {
  return new Response(robotsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
