import { NextResponse } from 'next/server';

const SESSION_COOKIE = 'ibanforge_session';

/*
 * Deleting the cookie is all this route can do, and that is worth stating
 * plainly (audit FRT-03, 2026-09-01): the session is stateless, so a token
 * copied off this browser before the logout stays valid until it expires.
 *
 * The revocation switch is SESSION_VERSION, read by lib/auth.ts and stamped
 * into every signed payload: bump it in the environment and every session ever
 * issued stops verifying, at once, without rotating SESSION_SECRET. That is
 * the lever to pull if a token is believed stolen — this route is not.
 */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
