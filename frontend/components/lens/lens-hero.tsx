'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { lensAssets } from './assets';
import { lensResponse, record } from './response';
import type { LensEngine, Projection } from './engine';

export type LensCopy = Record<string, string>;
const examples = [
  'CH10 0023 0000 0000 1234 5',
  'DE89 3704 0044 0532 0130 00',
  'CH11 0023 0000 0000 1234 5',
];

export function LensHero({
  copy: t,
  verdictCopy: v,
  playgroundHref,
  auditHref,
}: {
  copy: LensCopy;
  verdictCopy: LensCopy;
  playgroundHref: string;
  auditHref: string;
}) {
  const root = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const experience = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const detailHost = useRef<HTMLDivElement>(null);
  const json = useRef<HTMLPreElement>(null);
  const engine = useRef<LensEngine | null>(null);
  const detailEngine = useRef<LensEngine | null>(null);
  const layout = useRef<() => void>(() => {});
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const pausedRef = useRef(true);
  const [hydrated, setHydrated] = useState(false);
  const [visual, setVisual] = useState<'poster' | 'ready' | 'fixed'>('poster');
  const [paused, setPaused] = useState(true);
  const [detailPaused, setDetailPaused] = useState(true);
  const [iban, setIban] = useState(examples[0]);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [phase, setPhase] = useState<'idle' | 'edited' | 'loading' | 'live' | 'error'>('idle');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(-1);
  const [showJson, setShowJson] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const result = payload ? lensResponse(payload) : null;

  useEffect(() => {
    const el = host.current,
      area = experience.current,
      section = root.current;
    if (!el || !area || !section) return;
    let disposed = false,
      frame = 0;
    const invalidateRequest = () => {
      generation.current++;
    };
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const mobile = matchMedia('(max-width:820px)');
    function motion() {
      pausedRef.current = reduced.matches;
      setPaused(reduced.matches);
      setDetailPaused(reduced.matches);
      engine.current?.pause(reduced.matches || !!dialog.current?.open);
      detailEngine.current?.pause(reduced.matches);
    }
    function arrange() {
      frame = 0;
      if (!el || !area || !section || disposed) return;
      const rect = el.getBoundingClientRect(),
        outer = area.getBoundingClientRect();
      const fraction = mobile.matches ? 0.8 : rect.width < 1120 ? 0.73 : 0.75;
      const projection: Projection = engine.current?.raccorder(fraction) ?? {
        centre: { x: rect.width * 0.53, y: rect.height * 0.51 },
        marque: { x: rect.width * 0.53, y: rect.height * 0.17 },
        sorties: [0.31, 0.51, 0.71].map((y) => ({ x: rect.width * fraction, y: rect.height * y })),
      };
      const top = rect.top - outer.top;
      const signature = area.querySelector<HTMLElement>('.lens-signature')!;
      signature.style.left = projection.marque.x + 'px';
      signature.style.top =
        top + (mobile.matches ? projection.marque.y : Math.max(projection.marque.y, 50)) + 'px';
      area.querySelector<HTMLElement>('.lens-input')!.style.top = projection.centre.y + 'px';
      area.querySelectorAll<HTMLElement>('.lens-field').forEach((card, i) => {
        card.style.top = projection.sorties[i].y + 'px';
        card.style.left = projection.sorties[i].x + 'px';
      });
      area.querySelectorAll<HTMLElement>('[data-ray-label]').forEach((label, i) => {
        label.style.top = top + projection.sorties[i].y + 'px';
        label.style.left = projection.sorties[i].x + 'px';
        label.style.width = Math.min(66, rect.width - projection.sorties[i].x - 4) + 'px';
      });
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(arrange);
    }
    layout.current = schedule;
    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    mobile.addEventListener('change', schedule);
    reduced.addEventListener('change', motion);
    function fallback() {
      engine.current?.detruire();
      engine.current = null;
      setVisual('fixed');
      schedule();
    }
    async function start() {
      try {
        const { creerBraise } = await import('./engine.js');
        await document.fonts.ready;
        if (disposed) return;
        engine.current = creerBraise(el!, (signal) => {
          if (signal.perdu && !disposed) fallback();
        });
        engine.current.pause(pausedRef.current);
        setVisual('ready');
        schedule();
      } catch {
        if (!disposed) fallback();
      }
    }
    const visible = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          visible.disconnect();
          void start();
        }
      },
      { rootMargin: '120px' },
    );
    visible.observe(el);
    void Promise.resolve().then(() => {
      if (!disposed) {
        motion();
        setHydrated(true);
        schedule();
      }
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      visible.disconnect();
      mobile.removeEventListener('change', schedule);
      reduced.removeEventListener('change', motion);
      request.current?.abort();
      invalidateRequest();
      detailEngine.current?.detruire();
      detailEngine.current = null;
      engine.current?.detruire();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    engine.current?.donnees(
      payload ? lensResponse(payload).states : ['attente', 'attente', 'attente'],
    );
    engine.current?.surligner(-1);
    layout.current();
  }, [payload, visual]);

  function change(value: string) {
    generation.current++;
    request.current?.abort();
    setIban(value);
    setPayload(null);
    setPhase('edited');
    setError('');
    setShowJson(false);
    setSelected(-1);
    setCopyMessage('');
  }
  async function submit(value = iban) {
    request.current?.abort();
    const run = ++generation.current,
      controller = new AbortController();
    request.current = controller;
    setPayload(null);
    setPhase('loading');
    setShowJson(false);
    setCopyMessage('');
    setSelected(-1);
    const timer = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch('/api/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'iban', value: value.replace(/\s/g, '').toUpperCase() }),
        signal: controller.signal,
      });
      const data: unknown = await response.json();
      if (run !== generation.current) return;
      const body = record(data);
      if (!response.ok || typeof body.valid !== 'boolean') {
        setError(
          response.status === 429 || body.error === 'rate_limited' ? t.rateLimited : t.unavailable,
        );
        setPhase('error');
        return;
      }
      setPayload(body);
      setPhase('live');
      engine.current?.instant(0);
    } catch {
      if (run === generation.current) {
        setError(t.unavailable);
        setPhase('error');
      }
    } finally {
      window.clearTimeout(timer);
    }
  }
  function togglePause() {
    const next = !paused;
    pausedRef.current = next;
    setPaused(next);
    engine.current?.pause(next);
  }
  function closeDetail() {
    detailEngine.current?.detruire();
    detailEngine.current = null;
    engine.current?.pause(pausedRef.current);
  }
  async function openDetail() {
    if (!dialog.current || !detailHost.current) return;
    dialog.current.showModal();
    engine.current?.pause(true);
    setDetailPaused(pausedRef.current);
    try {
      const { creerBraise } = await import('./engine.js');
      if (!dialog.current?.open || !detailHost.current) return;
      detailEngine.current = creerBraise(detailHost.current, (signal) => {
        if (signal.perdu) dialog.current?.close();
      });
      detailEngine.current.inspection(true);
      detailEngine.current.donnees(['ok', 'ok', 'ok']);
      detailEngine.current.pause(pausedRef.current);
    } catch {
      dialog.current?.close();
      setCopyMessage(t.detailUnavailable);
    }
  }
  async function copyResult() {
    if (!payload) return;
    setShowJson(true);
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopyMessage(t.copied);
    } catch {
      requestAnimationFrame(() => {
        if (!json.current) return;
        json.current.focus();
        const range = document.createRange();
        range.selectNodeContents(json.current);
        const selection = getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        setCopyMessage(t.selectCopy);
      });
    }
  }
  const fields = [
    {
      title: t.format,
      value: result
        ? v[result.verdict.structure === 'valid' ? 'structureValid' : result.verdict.structure === 'invalid' ? 'structureInvalid' : 'notChecked']
        : t.waitFormat,
      source: result ? v.structureScope : t.formatHint,
    },
    {
      title: t.bank,
      value: result ? (result.bankName ?? v[result.verdict.bankStatus]) : t.waitBank,
      source: result ? v[result.verdict.bankStatus] : t.bankHint,
    },
    {
      title: 'BIC / SWIFT',
      value: result ? (result.bic ?? v.notProvided) : t.waitBic,
      source: result?.bic ? (result.verdict.bicSource ?? v.notProvided) : t.bicHint,
    },
  ];
  const status =
    phase === 'loading'
      ? t.loading
      : phase === 'error'
        ? error
        : phase === 'edited'
          ? t.edited
          : result
            ? `${v.apiResponse}. ${v[result.verdict.next]}`
            : t.initial;

  return (
    <section
      ref={root}
      className="lens-hero"
      aria-labelledby="lens-heading"
      data-lens-version="optique-2"
      data-visual={visual}
    >
      <div className="lens-heading">
        <p className="lens-eyebrow">{t.eyebrow}</p>
        <h1 id="lens-heading">
          {t.title}
          <br />
          <em>{t.titleAccent}</em>
        </h1>
        <p className="lens-promise">{t.promise}</p>
        <div className="lens-heading-actions">
          <Link href={auditHref} data-evt="cta:journey-audit">
            {t.auditLink} <span aria-hidden="true">↗</span>
          </Link>
          <button
            type="button"
            onClick={() => void openDetail()}
            disabled={visual !== 'ready'}
            aria-haspopup="dialog"
          >
            {t.observe} <span aria-hidden="true">↗</span>
          </button>
        </div>
      </div>
      <div className="lens-experience" ref={experience}>
        <div className="lens-scene">
          <Image
            src={lensAssets.poster}
            alt={t.sceneAlt}
            width={1707}
            height={769}
            priority
            sizes="100vw"
            className="lens-poster"
          />
          <div className="lens-canvas" ref={host} aria-hidden="true" />
        </div>
        <div className="lens-signature" aria-hidden="true">
          <span>
            IBAN<span>forge</span>
          </span>
          <small>{t.signature}</small>
        </div>
        <form
          className="lens-input"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p className="lens-eyebrow">01 · {t.inputEyebrow}</p>
          <h2>{t.inputTitle}</h2>
          <label htmlFor="lens-iban">{t.inputLabel}</label>
          <input
            id="lens-iban"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={50}
            value={iban}
            onChange={(e) => change(e.target.value)}
            aria-describedby="lens-input-note"
            required
          />
          <button
            className="lens-submit"
            disabled={!hydrated || phase === 'loading' || !iban.trim()}
            type="submit"
            data-evt="cta:journey-api"
          >
            {phase === 'loading' ? t.loading : t.submit} <span aria-hidden="true">→</span>
          </button>
          <div className="lens-examples" role="group" aria-label={t.examples}>
            {[t.switzerland, t.germany, t.errorExample].map((label, i) => (
              <button
                type="button"
                key={label}
                disabled={!hydrated}
                aria-pressed={iban === examples[i]}
                onClick={() => {
                  change(examples[i]);
                  void submit(examples[i]);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p id="lens-input-note">{t.inputNote}</p>
          <span className="lens-input-port" aria-hidden="true" />
        </form>
        <div
          className="lens-results"
          aria-label={t.results}
          aria-live="polite"
          aria-busy={phase === 'loading'}
        >
          {fields.map((field, i) => (
            <button
              key={field.title}
              type="button"
              className="lens-field"
              data-state={result?.states[i] ?? 'attente'}
              aria-pressed={selected === i}
              onClick={() => {
                const n = selected === i ? -1 : i;
                setSelected(n);
                engine.current?.surligner(n);
              }}
              onMouseEnter={() => engine.current?.surligner(i)}
              onMouseLeave={() => engine.current?.surligner(selected)}
              onFocus={() => engine.current?.surligner(i)}
              onBlur={() => engine.current?.surligner(selected)}
            >
              <span className="lens-port" aria-hidden="true" />
              <span className="lens-field-title">
                0{i + 1} · {field.title}
              </span>
              <strong>{field.value}</strong>
              <small>{field.source}</small>
            </button>
          ))}
        </div>
        <div className="lens-mobile-labels" aria-hidden="true">
          {[t.format, t.bank, 'BIC'].map((label) => (
            <span data-ray-label key={label}>
              {label}
            </span>
          ))}
        </div>
        <p className="lens-caption">{t.caption}</p>
        <button
          className="lens-pause"
          type="button"
          onClick={togglePause}
          disabled={visual !== 'ready'}
          aria-pressed={paused}
        >
          {visual === 'fixed' ? t.fixed : paused ? `▶ ${t.animate}` : `Ⅱ ${t.pause}`}
        </button>
      </div>
      <div className="lens-summary">
        <p role="status">{status}</p>
        <div>
          <button
            disabled={!payload}
            onClick={() => setShowJson(!showJson)}
            aria-expanded={showJson}
            aria-controls="lens-json"
          >
            {showJson ? t.hideJson : t.showJson}
          </button>
          <button disabled={!payload} onClick={() => void copyResult()}>
            {t.copy}
          </button>
        </div>
      </div>
      {result && (
        <div className="lens-source-details">
          <p>
            <b>
              {t.bank} · {v.source}
            </b>
            <span>
              {result.verdict.source ?? v.notProvided}
              {result.verdict.asOf ? ` · ${result.verdict.asOf}` : ''}
            </span>
          </p>
          <p>
            <b>BIC · {v.source}</b>
            <span>
              {result.verdict.bicSource ?? v.notProvided}
              {result.verdict.bicAsOf ? ` · ${result.verdict.bicAsOf}` : ''}
            </span>
          </p>
          {result.verdict.localCheckInvalid && (
            <p className="lens-warning">{v.localCheckInvalid}</p>
          )}
          {result.notices.map((notice) => (
            <p className="lens-notice" key={notice}>
              {notice}
            </p>
          ))}
        </div>
      )}
      <pre id="lens-json" hidden={!showJson} ref={json} tabIndex={0}>
        {payload ? JSON.stringify(payload, null, 2) : ''}
      </pre>
      {copyMessage && (
        <p className="lens-copy-status" role="status">
          {copyMessage}
        </p>
      )}
      <div className="lens-scope">
        <p>
          {v.holderScope} {t.scope}
        </p>
        <Link href={playgroundHref}>{t.playgroundLink} ↗</Link>
      </div>
      <noscript>
        <p className="lens-nojs">{t.noJs}</p>
      </noscript>
      <dialog
        className="lens-detail"
        ref={dialog}
        aria-labelledby="lens-detail-title"
        onClose={closeDetail}
      >
        <div className="lens-detail-header">
          <span id="lens-detail-title">{t.detailTitle}</span>
          <button type="button" onClick={() => dialog.current?.close()}>
            {t.close} ×
          </button>
        </div>
        <div className="lens-detail-canvas" ref={detailHost} aria-hidden="true" />
        <div className="lens-detail-footer">
          <span>{t.detailCaption}</span>
          <button
            type="button"
            aria-pressed={detailPaused}
            onClick={() => {
              detailEngine.current?.pause(!detailPaused);
              setDetailPaused(!detailPaused);
            }}
          >
            {detailPaused ? `▶ ${t.animate}` : `Ⅱ ${t.pause}`}
          </button>
        </div>
      </dialog>
    </section>
  );
}
