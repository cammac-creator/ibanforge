'use client';

import type { ReactNode } from 'react';

/** Le lien révèle les explications et y transfère le point de lecture. */
export function MetricGuideLink({ children, className }: { children: ReactNode; className: string }) {
  return (
    <a
      href="#metric-guide"
      className={className}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const guide = document.getElementById('metric-guide');
        if (!(guide instanceof HTMLDetailsElement)) return;
        event.preventDefault();
        guide.open = true;
        // Le saut natif après le clic retirerait le focus du titre.
        window.location.hash = guide.id;
        guide.scrollIntoView({ block: 'start' });
        guide.querySelector('summary')?.focus({ preventScroll: true });
      }}
    >
      {children}
    </a>
  );
}
