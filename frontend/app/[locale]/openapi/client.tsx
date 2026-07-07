'use client';

import { ApiReferenceReact } from '@scalar/api-reference-react';
import '@scalar/api-reference-react/style.css';

/**
 * Brand bridge: Scalar ships its own theme system (CSS layers `scalar-base` /
 * `scalar-theme`). Anything injected via `customCss` lands OUTSIDE those
 * layers, so it always wins — we point Scalar's variables at the IBANforge
 * tokens (ink ramp, warm fg, amber accent, JetBrains Mono) instead of the
 * default blue/white theme. `theme: 'none'` keeps the base structure without
 * a competing color preset, and dark mode is forced to match the site.
 */
const IBANFORGE_SCALAR_CSS = `
.dark-mode,
.light-mode {
  color-scheme: dark;
  --scalar-background-1: var(--ink-0, #09090B);
  --scalar-background-2: var(--ink-1, #0F0F13);
  --scalar-background-3: var(--ink-3, #1C1C22);
  --scalar-background-accent: rgba(245, 158, 11, 0.10);

  --scalar-color-1: var(--fg-1, #F5F3EF);
  --scalar-color-2: var(--fg-3, #A1A1AA);
  --scalar-color-3: var(--fg-4, #82828C);
  --scalar-color-accent: var(--amber-500, #F59E0B);

  --scalar-border-color: var(--ink-4, #27272A);

  --scalar-link-color: var(--amber-500, #F59E0B);
  --scalar-link-color-hover: var(--amber-400, #FBBF24);

  --scalar-button-1: var(--amber-500, #F59E0B);
  --scalar-button-1-hover: var(--amber-400, #FBBF24);
  --scalar-button-1-color: var(--ink-0, #09090B);

  --scalar-sidebar-background-1: var(--ink-0, #09090B);
  --scalar-sidebar-border-color: var(--ink-4, #27272A);
  --scalar-sidebar-color-1: var(--fg-2, #D4D4D8);
  --scalar-sidebar-color-2: var(--fg-4, #82828C);
  --scalar-sidebar-color-active: var(--amber-500, #F59E0B);
  --scalar-sidebar-item-active-background: rgba(245, 158, 11, 0.10);
  --scalar-sidebar-item-hover-background: var(--ink-2, #16161B);
  --scalar-sidebar-item-hover-color: var(--fg-1, #F5F3EF);
  --scalar-sidebar-search-background: var(--ink-1, #0F0F13);
  --scalar-sidebar-search-border-color: var(--ink-4, #27272A);
}

.scalar-app {
  --scalar-font: "Inter", "Inter Fallback", ui-sans-serif, system-ui, sans-serif;
  --scalar-font-code: "JetBrains Mono", "JetBrains Mono Fallback", ui-monospace, monospace;
}
`;

export function ApiReferenceClient() {
  return (
    <ApiReferenceReact
      configuration={{
        url: 'https://api.ibanforge.com/openapi.json',
        theme: 'none',
        darkMode: true,
        forceDarkModeState: 'dark',
        hideDarkModeToggle: true,
        withDefaultFonts: false,
        // Hide Scalar's dev toolbar (Deploy/Share buttons) — off-brand chrome.
        showDeveloperTools: 'never',
        customCss: IBANFORGE_SCALAR_CSS,
        hideClientButton: false,
        hideTestRequestButton: false,
        hideDownloadButton: false,
        layout: 'modern',
        defaultHttpClient: {
          targetKey: 'shell',
          clientKey: 'curl',
        },
        metaData: {
          title: 'IBANforge API Reference',
          description: 'IBAN validation, BIC lookup, Swiss BC-Nummer, compliance — REST API for AI agents and developers.',
        },
      }}
    />
  );
}
