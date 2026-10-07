import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { checkRegisterPageLimit, clientAddress } from './lib/register-page-limit';

const intl = createMiddleware(routing);

/*
 * The register page cap runs first, on the self-hosted site only (it does
 * nothing on Vercel, where a firewall rule holds it): see
 * lib/register-page-limit.ts. Everything else is next-intl, unchanged.
 */
export default function middleware(req: NextRequest) {
  const verdict = checkRegisterPageLimit({
    pathname: req.nextUrl.pathname,
    ip: clientAddress(req.headers),
    userAgent: req.headers.get('user-agent'),
  });
  if (verdict.limited) {
    return new NextResponse('Too many register pages from this address. Please try again in a few minutes.\n', {
      status: 429,
      headers: { 'Retry-After': String(verdict.retryAfter ?? 600), 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return intl(req);
}

export const config = {
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
