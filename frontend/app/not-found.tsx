/**
 * The 404 for paths that never reach a locale segment.
 *
 * The middleware skips every path with a dot in it (static files must not be
 * rewritten), so an unknown `/icon-512.png` or `/foo.txt` lands here, at the
 * root, where the layout renders no <html> of its own. Without this file Next
 * had nothing to render and answered 500 with its error shell (measured on
 * 2026-09-05; the Organization logo in the JSON-LD pointed at one). A page
 * under a locale goes through app/[locale]/[...rest] and the translated
 * not-found instead.
 */
export default function RootNotFound() {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0c0a09", color: "#fff7ed", fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <main style={{ textAlign: "center", padding: "2rem" }}>
          <p style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, letterSpacing: "0.2em", color: "#f59e0b", margin: 0 }}>404</p>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: "0.6rem 0" }}>This page does not exist.</h1>
          <p style={{ color: "#a8a29e", margin: "0 0 1.2rem" }}>IBANforge — IBAN, BIC and Swiss clearing API.</p>
          <a href="/" style={{ color: "#f59e0b", textDecoration: "underline", textUnderlineOffset: 4 }}>Back to the home page</a>
        </main>
      </body>
    </html>
  );
}
