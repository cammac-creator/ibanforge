import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { routing } from '@/i18n/routing';
import { localePath } from '@/lib/locale-path';
import { ANSWERS, PROPOSAL_KEY, type Answer } from '@/lib/dashboard/bulletin';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

/**
 * The answer buttons of the Monday bulletin (step A2): Oui, Plus tard or Non.
 *
 * The page posts a plain HTML form here (no JavaScript in the browser). This route
 * checks the session FIRST (it is enrolled in `private-routes-auth.test.ts`), then
 * the origin, reads the form, forwards `{ key, answer }` to the API with the admin
 * secret, which never reaches the browser, and comes back to the bulletin with a 303.
 *
 * The return address is built here from a locale of the router's list, never from
 * the request: this route cannot be used to send someone elsewhere.
 */
function back(req: NextRequest, locale: string, outcome: 'ok' | 'echec'): NextResponse {
  const path = `${localePath(locale, '/dashboard/bulletin')}?reponse=${outcome}#decisions`;
  return NextResponse.redirect(new URL(path, req.nextUrl.origin), 303);
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // SameSite=Lax already keeps the session cookie off a cross-site POST; an origin
  // that is not this site's is refused all the same.
  const origin = req.headers.get('origin');
  if (origin && origin !== req.nextUrl.origin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid_form' }, { status: 400 });
  }
  const rawLocale = form.get('locale');
  const locale =
    typeof rawLocale === 'string' && (routing.locales as readonly string[]).includes(rawLocale)
      ? rawLocale
      : routing.defaultLocale;
  const key = form.get('key');
  const answer = form.get('answer');
  if (
    typeof key !== 'string' ||
    !PROPOSAL_KEY.test(key) ||
    typeof answer !== 'string' ||
    !(ANSWERS as readonly string[]).includes(answer)
  ) {
    return back(req, locale, 'echec');
  }
  if (!API_URL || !ADMIN_SECRET) return back(req, locale, 'echec');
  try {
    const r = await fetch(`${API_URL}/v1/admin/bulletin/answers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
      body: JSON.stringify({ key, answer: answer as Answer }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    // An API that predates step A2 answers 404: said as a failure, never as saved.
    return back(req, locale, r.ok ? 'ok' : 'echec');
  } catch {
    return back(req, locale, 'echec');
  }
}
