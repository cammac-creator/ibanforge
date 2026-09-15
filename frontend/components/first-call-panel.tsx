'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  buildSnippets,
  firstCallUrl,
  summarizeFirstCall,
  DEMO_CONTEXT_HEADER,
  DEMO_CONTEXT_VALUE,
  SAMPLE_IBAN,
  type FirstCallSummary,
  type SnippetLanguage,
} from '@/lib/first-call';

type Status = 'idle' | 'running' | 'done' | 'failed';

const LANGUAGES: Array<{ id: SnippetLanguage; label: string }> = [
  { id: 'curl', label: 'curl' },
  { id: 'node', label: 'Node' },
  { id: 'python', label: 'Python' },
];

/**
 * "Run this call now", inside the dialog that just issued the key.
 *
 * One real call on a sample IBAN, the answer read aloud in one line, the raw
 * JSON one click away, and the same call in curl, Node and Python with the key
 * already in place. The purchase page has had this since August; the free
 * dialog, where most signups happen, did not. See lib/first-call.ts
 * for the measurement behind it.
 *
 * 🚨 `monthlyLimit` est le quota RÉEL de la clé qui vient d'être délivrée (25
 * sur une clé anonyme, 200 sur une clé avec adresse), lu de la réponse de
 * création : cette valeur ne se devine pas, et une clé anonyme à qui l'on
 * annoncerait 200 mentirait dès le premier appel.
 *
 * L'appel lancé d'ici est une DÉMONSTRATION et le dit, à l'écran comme dans
 * l'en-tête de contexte : les extraits à copier, eux, sont les appels du
 * visiteur et n'en portent pas.
 */
export function FirstCallPanel({ apiBase, apiKey, monthlyLimit }: { apiBase: string; apiKey: string; monthlyLimit: number }) {
  const t = useTranslations('apiKeyDialog.firstCall');
  const [status, setStatus] = useState<Status>('idle');
  const [summary, setSummary] = useState<FirstCallSummary | null>(null);
  const [json, setJson] = useState('');
  const [ms, setMs] = useState(0);
  const [failure, setFailure] = useState('');
  const [lang, setLang] = useState<SnippetLanguage>('curl');
  const [copied, setCopied] = useState(false);
  const snippets = buildSnippets(apiBase, apiKey);

  const run = async () => {
    setStatus('running');
    setFailure('');
    const started = performance.now();
    try {
      const url = firstCallUrl(apiBase);
      const body = JSON.stringify({ iban: SAMPLE_IBAN });
      const base = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
      let r: Response;
      try {
        r = await fetch(url, {
          method: 'POST',
          headers: { ...base, [DEMO_CONTEXT_HEADER]: DEMO_CONTEXT_VALUE },
          body,
        });
      } catch {
        // 🚨 Un en-tête personnalisé que l'API ne liste pas dans ses
        // `allowHeaders` est refusé au préambule CORS, et le navigateur rend
        // alors la MÊME erreur qu'une coupure réseau : les deux sont
        // indiscernables ici. Le marqueur de démonstration est un confort de
        // mesure, jamais une condition d'accès : on rejoue donc l'appel une
        // seule fois sans lui. La mesure classe cette lignée en « contexte
        // inconnu », ce que le contrat prévoit, au lieu de laisser le visiteur
        // devant un panneau mort sur la page qui vient de lui donner sa clé.
        // Le repli disparaîtra le jour où l'en-tête sera accepté au CORS.
        r = await fetch(url, { method: 'POST', headers: base, body });
      }
      const elapsed = Math.round(performance.now() - started);
      const answer: unknown = await r.json().catch(() => null);
      if (!r.ok) {
        const msg =
          answer && typeof answer === 'object' && typeof (answer as { message?: unknown }).message === 'string'
            ? (answer as { message: string }).message
            : `HTTP ${r.status}`;
        setFailure(msg);
        setStatus('failed');
        return;
      }
      setSummary(summarizeFirstCall(answer, r.headers));
      setJson(JSON.stringify(answer, null, 2));
      setMs(elapsed);
      setStatus('done');
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
      setStatus('failed');
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippets[lang]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The clipboard can be refused; the text stays selectable on screen.
    }
  };

  const headline = (s: FirstCallSummary) => {
    const parts: string[] = [];
    parts.push(s.valid === false ? t('invalid') : t('valid'));
    if (s.bankName) parts.push(s.bankName);
    if (s.bic) parts.push(s.bic);
    if (s.schemes.length) parts.push(`SEPA ${s.schemes.join(', ')}`);
    return parts.join(' · ');
  };

  return (
    <div className="border-t pt-4 mb-5" style={{ borderColor: 'var(--ink-4)' }}>
      <div className="font-mono text-xs uppercase tracking-caps mb-2" style={{ color: 'var(--amber-400)' }}>
        {t('title')}
      </div>
      {status === 'idle' && (
        <>
          <p className="text-sm mb-1.5" style={{ color: 'var(--fg-3)', lineHeight: 1.55 }}>
            {t('hint', { limit: monthlyLimit })}
          </p>
          <p className="text-xs mb-3" style={{ color: 'var(--fg-4)', lineHeight: 1.5 }}>
            {t('demoNote')}
          </p>
          <Button type="button" onClick={run} variant="amber" className="w-full">
            {t('run')}
          </Button>
        </>
      )}
      {status === 'running' && (
        <p className="text-sm" style={{ color: 'var(--fg-3)' }} aria-live="polite">
          {t('running')}
        </p>
      )}
      {status === 'failed' && (
        <div>
          <p role="alert" className="text-sm mb-3" style={{ color: 'var(--err)', lineHeight: 1.5 }}>
            {t('error', { message: failure })}
          </p>
          <Button type="button" onClick={run} variant="secondary">
            {t('again')}
          </Button>
        </div>
      )}
      {status === 'done' && summary && (
        <div aria-live="polite">
          <p className="text-sm mb-1" style={{ color: 'var(--fg-1)', lineHeight: 1.5 }}>
            <span style={{ color: 'var(--ok)' }}>●</span> {headline(summary)}
          </p>
          <p className="font-mono text-[11px] mb-3" style={{ color: 'var(--fg-4)' }}>
            {t('done', { ms })}
            {summary.quotaUsed !== null && summary.quotaLimit !== null
              ? ` · ${t('quota', { used: summary.quotaUsed, limit: summary.quotaLimit })}`
              : ''}
          </p>
          <details className="mb-4">
            <summary className="text-xs cursor-pointer underline underline-offset-2" style={{ color: 'var(--fg-3)' }}>
              {t('showJson')}
            </summary>
            <pre
              className="font-mono text-[11px] mt-2 p-3 rounded-md overflow-auto"
              style={{ background: 'var(--ink-2)', border: '1px solid var(--ink-4)', color: 'var(--fg-2)', maxHeight: 220, lineHeight: 1.45 }}
            >
              {json}
            </pre>
          </details>
          <div className="font-mono text-xs uppercase tracking-caps mb-1" style={{ color: 'var(--fg-3)' }}>
            {t('snippets')}
          </div>
          <p className="text-xs mb-2" style={{ color: 'var(--fg-4)', lineHeight: 1.5 }}>
            {t('snippetsNote')}
          </p>
          <div className="flex items-center gap-1 mb-2" role="tablist" aria-label={t('snippets')}>
            {LANGUAGES.map((l) => (
              <button
                key={l.id}
                type="button"
                role="tab"
                aria-selected={lang === l.id}
                onClick={() => setLang(l.id)}
                className="font-mono text-[11px] px-2 py-1 rounded-md cursor-pointer"
                style={{
                  background: lang === l.id ? 'var(--ink-3)' : 'transparent',
                  color: lang === l.id ? 'var(--fg-1)' : 'var(--fg-3)',
                  border: '1px solid var(--ink-4)',
                }}
              >
                {l.label}
              </button>
            ))}
            <span className="flex-1" />
            <button
              type="button"
              onClick={copy}
              className="font-mono text-[11px] px-2 py-1 rounded-md cursor-pointer"
              style={{ color: 'var(--amber-400)', background: 'transparent', border: '1px solid var(--ink-4)' }}
            >
              {copied ? t('copied') : t('copy')}
            </button>
          </div>
          <pre
            className="font-mono text-[11px] p-3 rounded-md overflow-auto whitespace-pre"
            style={{ background: 'var(--ink-2)', border: '1px solid var(--ink-4)', color: 'var(--fg-2)', maxHeight: 180, lineHeight: 1.45 }}
          >
            {snippets[lang]}
          </pre>
        </div>
      )}
    </div>
  );
}
