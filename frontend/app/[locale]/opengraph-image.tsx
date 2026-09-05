/**
 * The link preview card, one per locale, generated at build time.
 *
 * 🚨 This file lived at `app/` until 21/08/2026 and produced NOTHING: every
 * page renders from `app/[locale]/`, whose layout returns its own `openGraph`
 * object, and a segment's config replaces the one above it. Four and a half
 * months of shared links showed no preview at all. The fix was placement.
 *
 * Redrawn on 2026-09-05 (audit n° 10). The card used to be three lines of
 * system sans on black, in English whatever the page's language, with nothing
 * of the forge in it. It now carries the mark, the lockup, the fold's own
 * headline in the page's language, in the same Bebas the site sets its
 * titles in, and the tagline with the free tier.
 *
 * Bebas ships no lowercase, so everything here is capitals by design. The
 * mark is inlined as a data URI: satori fetches nothing at build time.
 */
import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Three cards, drawn at build time, one per locale. */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const alt = 'IBANforge — IBAN, BIC & Swiss clearing API';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const COAL = '#0c0a09';
const AMBER = '#f59e0b';
const HOT = '#fff7ed';
const MUTED = '#a8a29e';

function splitAccent(raw: string): [string, string, string] {
  const m = /^([\s\S]*?)<accent>([\s\S]*?)<\/accent>([\s\S]*)$/.exec(raw);
  return m ? [m[1], m[2], m[3]] : [raw.replace(/<\/?accent>/g, ''), '', ''];
}

export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'home' });
  const [before, accent, after] = splitAccent(t.raw('hero.title') as string);
  const [bebas, mark] = await Promise.all([
    readFile(join(process.cwd(), 'assets', 'bebas-neue.ttf')),
    readFile(join(process.cwd(), 'assets', 'anvil-mark.png')),
  ]);
  const markUri = `data:image/png;base64,${mark.toString('base64')}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '56px 72px 52px',
          backgroundColor: COAL,
          backgroundImage:
            'radial-gradient(circle at 82% 118%, rgba(245,158,11,0.34) 0%, rgba(239,68,68,0.10) 32%, rgba(12,10,9,0) 58%)',
          fontFamily: 'Bebas Neue',
          color: HOT,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- satori, not the DOM */}
          <img src={markUri} width={62} height={70} alt="" />
          <div style={{ display: 'flex', fontSize: 58, letterSpacing: 2, lineHeight: 1 }}>
            <span>IBAN</span>
            <span style={{ color: AMBER }}>FORGE</span>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            fontSize: 96,
            lineHeight: 1.02,
            letterSpacing: 1,
            maxWidth: 1056,
            textTransform: 'uppercase',
          }}
        >
          {/* one flex item per word: a multi-line span would push the accent
              onto a line of its own */}
          {before.trim().split(/\s+/).map((word, i) => (
            <span key={i} style={{ marginRight: 22 }}>{word}</span>
          ))}
          {accent && <span style={{ color: AMBER }}>{accent}</span>}
          {after && <span>{after}</span>}
        </div>
        <div style={{ display: 'flex', fontSize: 30, letterSpacing: 3, color: MUTED, textTransform: 'uppercase' }}>
          {t('share.tagline')}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: 'Bebas Neue', data: bebas, weight: 400, style: 'normal' }],
    },
  );
}
