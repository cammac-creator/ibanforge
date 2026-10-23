import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChannelsPanel, type ChannelRow } from './channels-panel';

vi.mock('./info-dot', () => ({ InfoDot: ({ children }: { children: ReactNode }) => children }));

const row = (client_kind: string, total: number): ChannelRow => ({
  client_kind, total, paid_calls: 0, paywall_hits: 0, errors: 0, avg_response_ms: 5,
});

describe('les canaux du tableau de bord', () => {
  it('nomme nos outils et leur place hors marché sans perdre leur volume', () => {
    const html = renderToStaticMarkup(createElement(ChannelsPanel, {
      periodDays: 7, rows: [row('internal', 17), row('mcp_http', 3)],
    }));
    expect(html).toContain('Nos outils');
    expect(html).toContain('Hors marché');
    expect(html).toContain('MCP hébergé');
    expect(html).toMatch(/>17<\/td>/);
    expect(html).not.toContain('internal');
    expect(html.indexOf('>17<')).toBeLessThan(html.indexOf('>3<'));
  });

  it('conserve un canal inconnu et traite une période vide', () => {
    const html = renderToStaticMarkup(createElement(ChannelsPanel, {
      periodDays: 7, rows: [row('canal-futur', 2)],
    }));
    expect(html).toContain('canal-futur');
    expect(renderToStaticMarkup(createElement(ChannelsPanel, { periodDays: 7, rows: [] })))
      .toContain('Aucun trafic sur la période.');
  });
});
