'use client';

import { Tooltip } from '@base-ui/react/tooltip';
import type { ReactNode } from 'react';

/**
 * Shared delay across all tooltips in the dashboard: once one opens, the next
 * one on the same row/card appears instantly. 150ms open delay feels snappy
 * without firing on casual mouse pass-throughs.
 */
export function DashboardTooltipProvider({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delay={150} closeDelay={80}>
      {children}
    </Tooltip.Provider>
  );
}
