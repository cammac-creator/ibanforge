/**
 * "Conquête": this client was WON by outbound prospecting — we wrote to them
 * before they ever minted a key. The rule and the reason it demands that proof
 * live in lib/crm/outreach.ts; nothing is decided here.
 *
 * One component for the two places it appears, rather than a chip drawn twice:
 * the table row and the contact sheet differ by one type size, and a second
 * copy is how a badge ends up gold in one half of the screen and amber in the
 * other. Same shape as the business chips beside it (rounded, uppercase, bold,
 * shrink-0), so it belongs to the same vocabulary instead of introducing a
 * second one — see lib/crm/business.ts.
 *
 * The classes carrying the animation are plain CSS from app/globals.css, not
 * Tailwind arbitrary values, and deliberately: Tailwind drops an arbitrary
 * value it cannot resolve without saying so, which would leave a chip that is
 * simply never animated in production and passes every test.
 *
 * The ✨ is also the glyph on the "déduit du site par l’IA" badge in the sheet
 * below, and the two never meet: that badge requires `source === AUTO_ENRICH`,
 * which is exactly the clause that forbids this chip. Mutually exclusive by the
 * rule itself rather than by luck, so one glyph never carries two meanings on
 * one screen.
 *
 * No 'use client': it holds no state and no handler. It is pulled into the
 * client bundle by its callers, and the directive would only forbid rendering
 * it on the server later.
 */
export function ConquestChip({ compact = false }: { compact?: boolean }) {
  return (
    <span
      title="Conquête : gagné par prospection sortante — on lui a écrit avant qu’il crée sa clé"
      className={`crm-conquest inline-flex shrink-0 items-center gap-1 self-center rounded px-1.5 py-0.5 font-bold uppercase tracking-wide ${
        compact ? 'text-[9.5px]' : 'text-[11px]'
      }`}
    >
      {/* The whole sentence for a screen reader, once. `title` does not appear
          on touch and is not reliably announced, and the word alone does not
          say what was conquered — the same reasoning the row's ⏰ badge uses. */}
      <span className="sr-only">Conquête : gagné par prospection sortante</span>
      <span aria-hidden className="crm-conquest-spark">
        ✨
      </span>
      <span aria-hidden>Conquête</span>
    </span>
  );
}
