'use client';

// global-error renders OUTSIDE NextIntlClientProvider so we cannot use
// useTranslations here. We accept a static EN-only message — this is a
// last-resort fallback when the full app tree has crashed. The locale path
// segment is unknown at this layer (Next.js renders global-error.tsx at the
// root, before locale resolution).
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: '#09090b', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Something went wrong</h2>
          <p style={{ fontSize: '0.85rem', marginBottom: '1.5rem', color: '#a1a1aa' }}>Une erreur est survenue · Etwas ist schiefgelaufen</p>
          <button onClick={reset} style={{ padding: '0.5rem 1rem', background: '#f59e0b', color: '#000', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
            Try again · Réessayer · Erneut versuchen
          </button>
        </div>
      </body>
    </html>
  );
}
