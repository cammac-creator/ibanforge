'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { routeKeyFailure } from '@/lib/api-key-failure';
import { attributionOf, readArrival, rememberArrival } from '@/lib/arrival';
import { FirstCallPanel } from '@/components/first-call-panel';

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

/**
 * `verify` is the step the 2026-08-17 anti-farm guard made mandatory and that
 * this dialog could not play until 2026-08-20.
 *
 * From the second key issued on a network, `POST /v1/keys/generate` answers
 * `403 verification_required`, mails a 6-digit code and asks for the SAME
 * request again with a `code` field. The dialog used to render that English
 * JSON instruction as a raw error string with a single "Try again" button that
 * re-POSTed without a code: every press mailed a fresh code, burned one of the
 * few daily sends allowed per recipient, and landed on the same wall. Anyone
 * behind a shared office NAT, a VPN or a carrier CGNAT — and anyone asking for
 * a second key — could not obtain one from the web at all.
 */
type Stage = 'form' | 'verify' | 'success' | 'error';

/** What Tab may land on inside the dialog. */
const FOCUSABLE =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Refusals we can phrase ourselves, in the visitor's language. Anything not
 * listed here keeps falling back to the API's own `message`, which is written
 * to be useful even when we have no translation for it.
 */
type Failure = { error?: unknown; reason?: unknown; message?: unknown };

/**
 * Acquisition attribution lives in lib/arrival.ts: captured when the visitor
 * ARRIVES (the only moment the referrer and the campaign query string are
 * still there), kept for the visit in sessionStorage, and sent with the key
 * request as `source` (our own ?src= tag) plus `attribution` (landing page,
 * referring host, utm labels). See that file for what reading it at POST time
 * cost: twenty-four days of empty attribution.
 */

export function ApiKeyDialogProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('apiKeyDialog');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const [stage, setStage] = useState<Stage>('form');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [result, setResult] = useState<KeyResponse | null>(null);
  const [error, setError] = useState<string>('');
  /** Inline warning shown above the field of the step the visitor is on. */
  const [notice, setNotice] = useState<string>('');
  const [copied, setCopied] = useState(false);
  /** The panel, so Tab can be kept inside it. */
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** Whatever had the focus when the dialog opened, to give it back. */
  const triggerRef = useRef<HTMLElement | null>(null);

  const reset = useCallback(() => {
    setStage('form');
    setBusy(false);
    setEmail('');
    setCode('');
    setResult(null);
    setError('');
    setNotice('');
    setCopied(false);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    // Hand the focus back to the button that opened the dialog. Without this it
    // fell to <body>, and a keyboard user who closed the dialog restarted their
    // journey through the page from the very top (WEB-18, audit 2026-09-01).
    // Done before the unmount so the browser has somewhere to put it.
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (trigger && document.contains(trigger)) trigger.focus();
    setTimeout(reset, 200);
  }, [reset]);

  const open = useCallback(() => {
    // Remembered here rather than in an effect: this is the only moment the
    // element that asked for the dialog still holds the focus.
    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    reset();
    setIsOpen(true);
  }, [reset]);

  // On arrival, once. This provider sits in the root layout, so it mounts on
  // the first paint of the landing page — which is the only moment the
  // referring `?src=` is still in the URL.
  useEffect(() => {
    rememberArrival();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (e.key !== 'Tab') return;
      // The dialog announced `aria-modal="true"` and trapped nothing: Tab
      // walked straight out of it and into the page behind, which the modal
      // claims is unreachable (WEB-18, audit 2026-09-01).
      //
      // The list is rebuilt on every press on purpose. This dialog swaps its
      // whole body between four stages (form, verify, success, error), so a
      // list captured once would name elements that no longer exist.
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && panel.contains(active);
      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [isOpen, close]);

  /**
   * Apply the routing decision. The decision itself lives in
   * `lib/api-key-failure.ts` so it can be unit-tested without a DOM; here we
   * only translate it and move the dialog.
   */
  const handleFailure = useCallback(
    (status: number, body: Failure) => {
      const route = routeKeyFailure(body.error, body.reason);

      if (route.step === 'verify') {
        if (route.notice === null) setCode('');
        setNotice(route.notice ? t(route.notice) : '');
        setStage('verify');
        return;
      }

      if (route.step === 'form') {
        setCode('');
        setNotice(t(route.notice));
        setStage('form');
        return;
      }

      // Unknown refusals keep falling back to the API's own message: it is
      // written to be actionable, and an English sentence beats an empty one.
      const fallback =
        (typeof body.message === 'string' && body.message) ||
        (typeof body.error === 'string' && body.error) ||
        `HTTP ${status}`;
      setError(route.message ? t(route.message) : fallback);
      setStage('error');
    },
    [t],
  );

  const requestKey = useCallback(
    async (verificationCode?: string) => {
      setBusy(true);
      setNotice('');
      setError('');
      try {
        // Best-effort acquisition attribution, as captured on ARRIVAL by
        // lib/arrival.ts rather than read here: the ?src= our outbound links
        // carry, plus the landing page, the referrer and the utm labels.
        const arrival = readArrival();
        const src = arrival?.src ?? null;
        const r = await fetch(`${API_BASE}/v1/keys/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            ...(verificationCode ? { code: verificationCode } : {}),
            ...(src ? { source: src } : {}),
            // Always an object from a browser, even an empty one: that is how
            // the API tells a browser signup from a curl or an agent.
            attribution: arrival ? attributionOf(arrival) : {},
          }),
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          handleFailure(r.status, body as Failure);
          return;
        }
        setResult(body as KeyResponse);
        setStage('success');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStage('error');
      } finally {
        setBusy(false);
      }
    },
    [email, handleFailure],
  );

  const submitEmail = (e: FormEvent) => {
    e.preventDefault();
    if (busy || !email.trim()) return;
    void requestKey();
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    // Never re-POST without a code from here: that would mail a fresh code and
    // spend one of the few daily sends allowed per recipient.
    const digits = code.replace(/\D/g, '');
    if (busy || digits.length !== 6) return;
    void requestKey(digits);
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
            ref={panelRef}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-xl border p-7 relative max-h-[92vh] overflow-y-auto"
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

            {stage === 'form' && (
              <form onSubmit={submitEmail}>
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
                {notice && (
                  <p
                    role="alert"
                    className="text-sm mb-4 rounded-md px-3 py-2"
                    style={{
                      color: 'var(--warn)',
                      background: 'var(--ink-2)',
                      border: '1px solid var(--ink-4)',
                      lineHeight: 1.5,
                    }}
                  >
                    {notice}
                  </p>
                )}
                <label
                  htmlFor="apikey-email"
                  className="font-sans text-xs font-medium uppercase tracking-caps mb-1.5 block"
                  style={{ color: 'var(--fg-3)' }}
                >
                  {t('emailLabel')}
                </label>
                <input
                  id="apikey-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('emailPlaceholder')}
                  autoFocus
                  disabled={busy}
                  className="w-full px-3 py-2.5 font-mono text-sm rounded-md border outline-none mb-5"
                  style={{
                    background: 'var(--ink-2)',
                    borderColor: 'var(--ink-4)',
                    color: 'var(--fg-1)',
                  }}
                />
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? t('submitting') : t('submit')}
                </Button>
                <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--fg-3, #71717a)' }}>
                  {t.rich('termsNotice', {
                    terms: (chunks) => (
                      <a href={`/${locale}/legal/terms`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                        {chunks}
                      </a>
                    ),
                    privacy: (chunks) => (
                      <a href={`/${locale}/legal/privacy`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                        {chunks}
                      </a>
                    ),
                  })}
                </p>
              </form>
            )}

            {stage === 'verify' && (
              <form onSubmit={submitCode}>
                <div
                  className="font-mono text-xs uppercase tracking-caps mb-2"
                  style={{ color: 'var(--amber-400)' }}
                >
                  IBANforge · {t('verify.eyebrow')}
                </div>
                <h2
                  id="apikey-title"
                  className="font-sans font-bold mb-3"
                  style={{ fontSize: 26, color: 'var(--fg-1)', letterSpacing: '-0.02em' }}
                >
                  {t('verify.title')}
                </h2>
                <p className="text-sm mb-2" style={{ color: 'var(--fg-3)', lineHeight: 1.6 }}>
                  {t('verify.subtitle', { email: email.trim().toLowerCase() })}
                </p>
                <p className="text-xs mb-5" style={{ color: 'var(--fg-4)', lineHeight: 1.55 }}>
                  {t('verify.why')}
                </p>
                {notice && (
                  <p
                    role="alert"
                    className="text-sm mb-4 rounded-md px-3 py-2"
                    style={{
                      color: 'var(--warn)',
                      background: 'var(--ink-2)',
                      border: '1px solid var(--ink-4)',
                      lineHeight: 1.5,
                    }}
                  >
                    {notice}
                  </p>
                )}
                <label
                  htmlFor="apikey-code"
                  className="font-sans text-xs font-medium uppercase tracking-caps mb-1.5 block"
                  style={{ color: 'var(--fg-3)' }}
                >
                  {t('verify.codeLabel')}
                </label>
                <input
                  id="apikey-code"
                  type="text"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoFocus
                  disabled={busy}
                  className="w-full px-3 py-2.5 font-mono rounded-md border outline-none mb-5"
                  style={{
                    background: 'var(--ink-2)',
                    borderColor: 'var(--ink-4)',
                    color: 'var(--fg-1)',
                    fontSize: 20,
                    letterSpacing: '0.35em',
                  }}
                />
                <Button
                  type="submit"
                  disabled={busy || code.replace(/\D/g, '').length !== 6}
                  className="w-full"
                >
                  {busy ? t('verify.submitting') : t('verify.submit')}
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setCode('');
                    setNotice('');
                    setStage('form');
                  }}
                  disabled={busy}
                  className="mt-3 w-full text-xs underline underline-offset-2"
                  style={{ color: 'var(--fg-3)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  {t('verify.changeEmail')}
                </button>
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
                <FirstCallPanel apiBase={API_BASE} apiKey={result.api_key} monthlyLimit={result.monthly_limit} />
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
                <Button
                  onClick={() => {
                    setNotice('');
                    setCode('');
                    setStage('form');
                  }}
                  variant="secondary"
                >
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
  evt,
}: {
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'link' | 'destructive' | 'amber';
  size?: 'default' | 'xs' | 'sm' | 'lg' | 'icon';
  /** Name reported by components/forge/cta-beacon.tsx on click. */
  evt?: string;
}) {
  const { open } = useApiKeyDialog();
  return (
    <Button type="button" onClick={open} className={className} variant={variant} size={size} data-evt={evt}>
      {children}
    </Button>
  );
}
