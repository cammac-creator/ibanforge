'use client';

import { useEffect, useRef } from 'react';

/**
 * WHY the drawer closed, which decides whether the keyboard goes back to the
 * row that opened it.
 *
 * 'escape' and 'button' are gestures aimed AT the drawer: the operator asked to
 * leave, and leaving with the caret on `body` is what makes the next Tab
 * restart at the top of the dashboard. 'outside' is not — a pointerdown on the
 * search field, a tile or a chip has already named the next focus target, and
 * taking it back is stealing a click the operator made.
 */
export type CloseReason = 'escape' | 'button' | 'outside';

/** Where a first Escape means "leave this field", not "leave the drawer". */
function isTextField(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * The detail as a drawer over the table.
 *
 * The pane it replaces was a permanent half of the screen that said "Sélectionne
 * un contact" for as long as nothing was open. A drawer costs the same pixels
 * only while it is being read, and the table it slides over stays live: a click
 * on another row switches the drawer to that contact instead of closing it,
 * which is the one thing the two-column layout did well and the reason the
 * outside-click rule below has an exception in it.
 *
 * Deliberately NOT `aria-modal`. Nothing behind it is inert — the rows are
 * still targets, the page still scrolls — and claiming modality would tell a
 * screen-reader user the opposite of what the mouse can do. It is a non-modal
 * dialog: focus moves in on open and returns to the row that opened it when the
 * operator asks to LEAVE (Escape, ✕) — never when they closed it by clicking
 * something else, which would take back the target they just named. Escape
 * closes, and nothing is trapped.
 *
 * It stays mounted while closed, holding the last contact opened. Two reasons:
 * the exit slide would otherwise animate an empty box, and the transition needs
 * an element that already exists at translate-x-full for the browser to have
 * something to interpolate from. `inert` is what keeps that held-over content
 * out of the tab order and out of the accessibility tree meanwhile.
 */
export function ContactDrawer({
  open,
  label,
  onClose,
  children,
}: {
  open: boolean;
  /** What the dialog is called, for a screen reader. */
  label: string;
  onClose: (reason: CloseReason) => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Into the drawer, on the one control every drawer has. Not into the
    // thread: the first thing a keyboard user needs is the way out.
    closeButton.current?.focus();

    /**
     * Escape, with the two guards a global keydown listener owes a panel that
     * contains a composer.
     *
     * `isComposing` (and the 229 keyCode its older spelling uses): an operator
     * composing CJK text in the reply body presses Escape to cancel the
     * composition, and that keydown reaches window like any other. Closing the
     * whole fiche mid-word is the classic IME bug this one line exists for.
     *
     * Then the field: with the caret in an input, a textarea or a select
     * INSIDE the panel, the first Escape leaves the field and the second leaves
     * the drawer. That is the escalation a stray Escape mid-typing needs — one
     * key press can no longer dismiss the workspace being written in — and it
     * costs the keyboard user nothing, since the second press still closes.
     */
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (e.isComposing || e.keyCode === 229) return;
      const active = panel.current?.ownerDocument.activeElement ?? null;
      if (isTextField(active) && panel.current?.contains(active)) {
        (active as HTMLElement).blur();
        return;
      }
      onClose('escape');
    }
    /**
     * Outside, with one exception: a row of the table. Clicking a contact must
     * move the drawer to that contact, not close it and demand a second click.
     * Written on pointerdown rather than click so a drag that starts inside the
     * drawer and ends outside it does not read as a click outside.
     *
     * `data-crm-row` sits on the row's positioned WRAPPER, not on the row
     * button, so the hover actions (💤 7 j / 📥 / ✓ lu) are row territory too:
     * they are a sibling of the button, and a rule that closed the drawer on
     * them would contradict this very exception — acting on a row must not cost
     * the fiche being read. See contact-table.tsx.
     */
    function onPointerDown(e: PointerEvent) {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (panel.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-crm-row]')) return;
      onClose('outside');
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, onClose]);

  return (
    <aside
      ref={panel}
      role="dialog"
      aria-label={label}
      inert={!open}
      className={[
        'fixed inset-y-0 right-0 z-[90] w-full border-l border-[var(--ink-4)] bg-[var(--ink-2)]',
        // 640 and not the original 460: the drawer is where mails are read and
        // written, and at 460 the composer was "trop petite pour travailler
        // agréablement" (owner, 28/08). Still a drawer, the table stays visible
        // beside it on a desktop; 94% keeps a sliver of context on tablets.
        'shadow-[-18px_0_44px_rgba(0,0,0,0.5)] sm:w-[min(640px,94%)]',
        'transition-transform duration-[220ms] ease-out motion-reduce:transition-none',
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
      ].join(' ')}
    >
      {/*
        The positioned container the writing sheets anchor to, and the p-4 they
        count on: both subtract it from the height they cover, as
        PANEL_PADDING_PX (panel-padding.ts). A class cannot read a constant, so
        nothing enforces the pair; change this padding and that constant must
        change with it.
      */}
      <div className="relative flex h-full min-w-0 flex-col p-4">
        <button
          ref={closeButton}
          type="button"
          onClick={() => onClose('button')}
          aria-label="Fermer la fiche"
          className="absolute right-3 top-3 z-20 rounded-md border border-[var(--ink-5)] bg-[var(--ink-2)] px-2 py-0.5 text-[13px] text-[var(--fg-3)] transition-colors hover:border-[var(--fg-4)] hover:text-[var(--fg-1)]"
        >
          ✕
        </button>
        {children}
      </div>
    </aside>
  );
}
