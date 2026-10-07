import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { routing } from '@/i18n/routing';
import { localePath } from '@/lib/locale-path';
import { ANSWERS, PROPOSAL_KEY, type Answer } from '@/lib/dashboard/bulletin';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

/**
 * Les boutons de réponse du bulletin du lundi (étape A2) : Oui, Plus tard ou Non.
 *
 * La page poste ici un simple formulaire HTML (aucun JavaScript dans le navigateur).
 * Cette route vérifie D'ABORD la session (elle est inscrite d'office dans
 * `private-routes-auth.test.ts`), puis l'origine, lit le formulaire, transmet
 * `{ key, answer }` à l'API avec le secret d'administration, qui n'atteint jamais le
 * navigateur, et revient au bulletin par un 303.
 *
 * L'adresse de retour est un CHEMIN, construit ici à partir d'une langue de la liste du
 * routeur, jamais tiré de la requête : cette route ne peut envoyer personne ailleurs, et
 * le navigateur reste sur l'hôte où il a posté, là où vit son cookie de session.
 * (`req.nextUrl.origin` n'est pas toujours cet hôte : sur un `next start -H 127.0.0.1`
 * local, mesuré le 07.10.2026, il différait de l'Origin envoyée par WebKit, et chaque
 * clic était refusé.)
 */
function back(locale: string, outcome: 'ok' | 'echec'): NextResponse {
  const path = `${localePath(locale, '/dashboard/bulletin')}?reponse=${outcome}#decisions`;
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

/** Une page qui poste depuis ce même hôte : l'en-tête Origin nomme l'hôte que la requête a atteint. */
function sameHost(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const host = req.headers.get('host');
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // SameSite=Lax écarte déjà le cookie de session d'un POST venu d'un autre site ; une
  // origine qui n'est pas celle de ce site est refusée quand même.
  if (!sameHost(req)) {
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
    return back(locale, 'echec');
  }
  if (!API_URL || !ADMIN_SECRET) return back(locale, 'echec');
  try {
    const r = await fetch(`${API_URL}/v1/admin/bulletin/answers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
      body: JSON.stringify({ key, answer: answer as Answer }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    // Une API d'avant l'étape A2 répond 404 : dit comme un échec, jamais comme enregistré.
    return back(locale, r.ok ? 'ok' : 'echec');
  } catch {
    return back(locale, 'echec');
  }
}
