'use client';

import { useState } from 'react';

interface Result {
  subject: string;
  email_en: string;
  translation_fr: string;
  deposited_in: string;
  account: string;
}

export function GenerateMailButton({
  name,
  to,
  account,
  subject,
  brief,
}: {
  name: string;
  to: string;
  account: string;
  subject: string;
  brief: string;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/crm/generate-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, to, subject, context: brief }),
      });
      const data = await r.json();
      if (!r.ok) setError(data.message || data.error || 'Échec');
      else setResult(data as Result);
    } catch {
      setError('Erreur réseau');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={generate}
        disabled={loading}
        className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
        title="Générer le mail (IA) et le déposer en brouillon"
      >
        {loading ? '… génération' : '✉️ Générer'}
      </button>
      {error && <div className="mt-1 text-[10px] text-red-400">{error}</div>}

      {result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setResult(null)}>
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900 p-5 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">Aperçu — {name}</p>
                <p className="text-[11px] text-green-400">
                  ✓ déposé dans « {result.deposited_in} » de {result.account} — relis et clique Envoyer
                </p>
              </div>
              <button type="button" onClick={() => setResult(null)} className="text-lg text-zinc-500 hover:text-white">
                ✕
              </button>
            </div>
            <p className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">Objet</p>
            <p className="mb-4 text-sm text-zinc-200">{result.subject}</p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-amber-400">Mail envoyé (EN)</p>
                <pre className="whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-200">
                  {result.email_en}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-blue-400">Traduction FR (toi seul, non envoyée)</p>
                <pre className="whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-400">
                  {result.translation_fr}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
