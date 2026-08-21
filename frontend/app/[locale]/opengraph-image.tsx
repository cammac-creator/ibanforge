/**
 * The link preview card, generated at build time.
 *
 * 🚨 This file lived at `app/` until 21/08/2026 and produced NOTHING. Every
 * page of the site renders from `app/[locale]/`, whose layout returns an
 * explicit `openGraph` object from generateMetadata; a segment's own config
 * replaces the one above it, so the root image never attached to any rendered
 * route. Measured on the live site the day it was moved: no `og:image` and no
 * `twitter:image` on the home page, on pricing, on docs, or in any of the three
 * languages, while `twitter:card` announced `summary_large_image` — a card type
 * that exists to promise a large image. Four and a half months of links shared
 * on forums and in messages showed no preview at all.
 *
 * The fix is placement, and Next states the rule: the more specific image takes
 * precedence over any above it in the folder structure. Here is the segment
 * that actually renders.
 *
 * The `runtime = 'edge'` export was removed at the same time: this version's own
 * documentation says the Edge Runtime is deprecated and the export should go.
 */
import { ImageResponse } from 'next/og';

export const alt = 'IBANforge — IBAN Validation & BIC/SWIFT Lookup API';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#09090b',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ fontSize: 72, fontWeight: 700, color: '#f59e0b', marginBottom: 20 }}>
          IBANforge
        </div>
        <div style={{ fontSize: 32, color: '#a1a1aa', textAlign: 'center', maxWidth: 800 }}>
          IBAN Validation & BIC/SWIFT Lookup API
        </div>
        <div style={{ fontSize: 24, color: '#71717a', marginTop: 20 }}>
          for developers and AI agents
        </div>
      </div>
    ),
    { ...size },
  );
}
