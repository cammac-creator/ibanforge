'use client';

import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://api.ibanforge.com';

interface ApiKeyDialogContextValue {
  open: () => void;
}

const Ctx = createContext<ApiKeyDialogContextValue>({ open: () => {} });

interface KeyResponse {
  api_key: string;
  key_prefix: string;
  email: string;
  monthly_limit: number;
  message: string;
}

type Stage = 'form' | 'loading' | 'success' | 'error';

export function ApiKeyDialogProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('apiKeyDialog');
  const tCommon = useTranslations('common');
  const [isOpen, setIsOpen] = useState(false);
  const [stage, setStage] = useState<Stage>('form');
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<KeyResponse | null>(null);
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const reset = useCallback(() => {
    setStage('form');
    setEmail('');
    setResult(null);
    setError('');
    setCopied(false);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setTimeout(reset, 200);
  }, [reset]);

  const open = useCallback(() => {
    reset();
    setIsOpen(true);
  }, [reset]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [isOpen, close]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStage('loading');
    setError('');
    try {
      const r = await fetch(`${API_BASE}/v1/keys/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        const msg = body?.message || body?.error || `HTTP ${r.status}`;
        setError(msg);
        setStage('error');
        return;
      }
      const data = (await r.json()) as KeyResponse;
      setResult(data);
      setStage('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage('error');
    }
  };

  const copyKey = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.api_key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="apikey-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={close}
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-xl border p-7 relative"
            style={{
              borderColor: 'var(--ink-4)',
              background: 'var(--ink-1)',
              boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
            }}
          >
            <button
              type="button"
              onClick={close}
              aria-label={t('close')}
              className="absolute top-3 right-3 w-8 h-8 rounded-md flex items-center justify-center cursor-pointer transition-colors"
              style={{ color: 'var(--fg-3)', background: 'transparent', border: 'none' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--ink-3)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              ✕
            </button>

            {(stage === 'form' || stage === 'loading') && (
              <form onSubmit={submit}>
                <div
                  className="font-mono text-xs uppercase tracking-caps mb-2"
                  style={{ color: 'var(--amber-400)' }}
                >
                  IBANforge · {t('eyebrow')}
                </div>
                <h2
                  id="apikey-title"
                  className="font-sans font-bold mb-3"
                  style={{ fontSize: 26, color: 'var(--fg-1)', letterSpacing: '-0.02em' }}
                >
                  {t('title')}
                </h2>
                <p className="text-sm mb-6" style={{ color: 'var(--fg-3)', lineHeight: 1.6 }}>
                  {t('subtitle')}
                </p>
                <label
                  className="font-sans text-xs font-medium uppercase tracking-caps mb-1.5 block"
                  style={{ color: 'var(--fg-3)' }}
                >
                  {t('emailLabel')}
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('emailPlaceholder')}
                  autoFocus
                  disabled={stage === 'loading'}
                  className="w-full px-3 py-2.5 font-mono text-sm rounded-md border outline-none mb-5"
                  style={{
                    background: 'var(--ink-2)',
                    borderColor: 'var(--ink-4)',
                    color: 'var(--fg-1)',
                  }}
                />
                <Button type="submit" disabled={stage === 'loading'} className="w-full">
                  {stage === 'loading' ? t('submitting') : t('submit')}
                </Button>
              </form>
            )}

            {stage === 'success' && result && (
              <div>
                <div
                  className="font-mono text-xs uppercase tracking-caps mb-2"
                  style={{ color: 'var(--ok)' }}
                >
                  ● {t('keyCreated')}
                </div>
                <h2
                  className="font-sans font-bold mb-3"
                  style={{ fontSize: 26, color: 'var(--fg-1)', letterSpacing: '-0.02em' }}
                >
                  {t('successTitle')}
                </h2>
                <p className="text-xs mb-4" style={{ color: 'var(--warn)', lineHeight: 1.55 }}>
                  {t('successWarn')}
                </p>
                <div
                  className="font-mono text-xs px-3 py-3 rounded-md mb-3 break-all"
                  style={{
                    background: 'var(--ink-2)',
                    border: '1px solid var(--amber-500)',
                    color: 'var(--amber-300)',
                    lineHeight: 1.5,
                  }}
                >
                  {result.api_key}
                </div>
                <div className="flex gap-2 mb-6 items-center">
                  <Button onClick={copyKey} type="button">
                    {copied ? `✓ ${tCommon('copied')}` : t('copy')}
                  </Button>
                  <span className="font-mono text-xs" style={{ color: 'var(--fg-4)' }}>
                    {t('monthly')}: {result.monthly_limit}/mo
                  </span>
                </div>
                <div className="border-t pt-4" style={{ borderColor: 'var(--ink-4)' }}>
                  <div
                    className="font-mono text-xs uppercase tracking-caps mb-2"
                    style={{ color: 'var(--fg-3)' }}
                  >
                    {t('nextSteps')}
                  </div>
                  <ol
                    className="text-sm space-y-1.5 list-decimal pl-5"
                    style={{ color: 'var(--fg-2)', lineHeight: 1.55 }}
                  >
                    <li>{t('step1')}</li>
                    <li>{t('step2')}</li>
                    <li>
                      <a
                        href="https://api.ibanforge.com/openapi.json"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'var(--amber-400)' }}
                      >
                        {t('step3')}
                      </a>
                    </li>
                  </ol>
                </div>
              </div>
            )}

            {stage === 'error' && (
              <div>
                <div
                  className="font-mono text-xs uppercase tracking-caps mb-2"
                  style={{ color: 'var(--err)' }}
                >
                  ● {t('errorTitle')}
                </div>
                <h2
                  className="font-sans font-bold mb-3"
                  style={{ fontSize: 22, color: 'var(--fg-1)', letterSpacing: '-0.02em' }}
                >
                  {t('errorHeadline')}
                </h2>
                <p className="text-sm mb-5" style={{ color: 'var(--fg-2)', lineHeight: 1.55 }}>
                  {error}
                </p>
                <Button onClick={() => setStage('form')} variant="secondary">
                  {t('retry')}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useApiKeyDialog() {
  return useContext(Ctx);
}

/**
 * Client CTA that opens the free-API-key dialog. Server components (home,
 * pricing) can't call the hook directly, so they render this instead.
 */
export function GetKeyButton({
  children,
  className,
  variant,
  size = 'lg',
}: {
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'link' | 'destructive';
  size?: 'default' | 'xs' | 'sm' | 'lg' | 'icon';
}) {
  const { open } = useApiKeyDialog();
  return (
    <Button type="button" onClick={open} className={className} variant={variant} size={size}>
      {children}
    </Button>
  );
}
