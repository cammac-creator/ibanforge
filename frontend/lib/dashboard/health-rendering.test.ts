import { Fragment, createElement, type ReactNode, type ComponentType, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveHealthStrip, RecordedActivity } from '@/components/dashboard/live-health-strip';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';
import de from '@/messages/de.json';

vi.mock('@/components/dashboard/info-dot', () => ({
  InfoDot: ({ children }: { children: ReactNode }) => createElement('span', null, children),
}));
const Provider = NextIntlClientProvider as ComponentType<
  Omit<ComponentProps<typeof NextIntlClientProvider>, 'children'> & { children?: ReactNode }
>;
function render(locale: 'fr' | 'en' | 'de', readAt = Date.parse('2026-11-06T12:00:00Z')) {
  return renderToStaticMarkup(
    createElement(
      Provider,
      { locale, messages: { fr, en, de }[locale], timeZone: 'UTC', now: new Date(readAt) },
      createElement(Fragment, null, createElement(LiveHealthStrip),
        createElement(RecordedActivity, { lastWriteAt: '2026-11-06 11:55:00', readAt })),
    ),
  );
}
afterEach(() => vi.restoreAllMocks());

describe('Le bandeau relie la dernière écriture au même instant de lecture', () => {
  it.each(['fr', 'en', 'de'] as const)('rend le premier état traduit et neutre en %s', (locale) => {
    const html = render(locale);
    expect(html).toContain({ fr, en, de }[locale].dashboard.monitoring.checking);
    expect(html).not.toContain('text-green-400');
    expect(html).not.toContain('border-amber-500/40');
    expect(html).not.toMatch(/NaN|MISSING_MESSAGE/);
  });
  it('ne dépend pas de l’horloge du navigateur lors de l’hydratation', () => {
    const clock = vi.spyOn(Date, 'now');
    clock.mockReturnValue(Date.parse('2026-11-06T12:00:00Z'));
    const server = render('fr');
    clock.mockReturnValue(Date.parse('2026-11-07T08:00:00Z'));
    expect(render('fr')).toBe(server);
  });
  it('reprend un nouvel instant de lecture même si la dernière écriture est identique', () => {
    expect(render('fr')).toContain('il y a 5 min');
    const later = render('fr', Date.parse('2026-11-06T13:00:00Z'));
    expect(later).toContain('il y a 65 min');
    expect(later).toContain('border-amber-500/40');
    expect(later).toContain('Cela peut correspondre à une période calme');
  });
});
