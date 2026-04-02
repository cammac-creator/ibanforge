import { ImageResponse } from 'next/og';

export const runtime = 'edge';
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
