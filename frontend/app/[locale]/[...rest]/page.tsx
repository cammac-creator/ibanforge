import { notFound } from "next/navigation";

/**
 * Every path under a locale that matches no route ends here and calls
 * notFound(), which renders app/[locale]/not-found.tsx inside the locale
 * layout: the translated page, with the header and the footer. Without this
 * catch-all, `/fr/nope` fell through to Next's default English 404 without
 * the shell (measured on 2026-09-05).
 */
export default function CatchAll() {
  notFound();
}
