'use client';

import { Tooltip } from '@base-ui/react/tooltip';
import type { ReactNode } from 'react';

/**
 * A tiny "?" bubble that shows explanatory text on hover/focus.
 * Use next to dashboard titles or numbers where the meaning isn't obvious
 * from the label alone.
 */
export function InfoDot({ children, side = 'top' }: { children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <button
            type="button"
            aria-label="More information"
            className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-[var(--ink-5)]/80 text-[9px] font-medium text-[var(--fg-4)] transition-colors hover:border-[var(--fg-4)] hover:text-[var(--fg-2)] focus-visible:border-[var(--fg-3)] focus-visible:text-[var(--fg-1)] focus-visible:outline-none"
          >
            ?
          </button>
        }
      />
      <Tooltip.Portal>
        <Tooltip.Positioner side={side} sideOffset={6}>
          <Tooltip.Popup className="max-w-[260px] rounded-md border border-[var(--ink-5)]/60 bg-[var(--ink-0)]/95 px-3 py-2 text-xs leading-snug text-[var(--fg-1)] shadow-lg shadow-black/40 backdrop-blur">
            {children}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/**
 * Wrap any inline node with a hover-tooltip without the "?" marker.
 * Useful for tables/bars where the cell itself is the trigger.
 */
export function HoverTooltip({
  children,
  content,
  side = 'top',
}: {
  children: ReactNode;
  content: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={<span className="inline-flex cursor-default">{children as never}</span>} />
      <Tooltip.Portal>
        <Tooltip.Positioner side={side} sideOffset={6}>
          <Tooltip.Popup className="max-w-[300px] rounded-md border border-[var(--ink-5)]/60 bg-[var(--ink-0)]/95 px-3 py-2 text-xs leading-snug text-[var(--fg-1)] shadow-lg shadow-black/40 backdrop-blur">
            {content}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
