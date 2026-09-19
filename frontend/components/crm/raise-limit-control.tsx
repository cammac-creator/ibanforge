'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { formatGrouped } from '@/lib/format-grouped';

/** Relève le plafond de la clé, selon son assiette mensuelle ou à vie.
 * L’API applique la nouvelle limite au prochain appel. Le geste reste confirmé par l’opérateur. */
export function RaiseLimitControl({ prefix, currentLimit, lifetime = false }: { prefix: string; currentLimit: number; lifetime?: boolean }) {
  const locale = useLocale();
  const basis = lifetime ? ' au total' : '/mois';
  const [target, setTarget] = useState(Math.min(20_000, Math.max(1000, currentLimit * 5)));
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  if (state === 'done') {
    return (
      <p className="mt-1 text-[12px] text-emerald-400">
        ✓ {prefix} relevé à {formatGrouped(target, locale)}{basis} — effet à leur prochain appel. {message}
      </p>
    );
  }
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <span className="font-mono text-[12px] text-red-200/90">
        {prefix} · {formatGrouped(currentLimit, locale)}{basis}
      </span>
      <select
        aria-label={`Nouveau plafond pour ${prefix}`}
        value={target}
        onChange={(e) => setTarget(Number(e.target.value))}
        className="rounded border border-red-400/40 bg-[var(--ink-1)] px-1.5 py-1 text-base text-[var(--fg-1)] sm:text-[12px]"
      >
        {[1000, 2000, 5000, 10_000, 20_000]
          .filter((n) => n > currentLimit)
          .map((n) => (
            <option key={n} value={n}>
              {formatGrouped(n, locale)}{basis}
            </option>
          ))}
      </select>
      <button
        type="button"
        disabled={state === 'busy'}
        onClick={async () => {
          if (!window.confirm(`Relever ${prefix} de ${currentLimit} à ${target}${basis} ?`)) return;
          setState('busy');
          try {
            const r = await fetch('/api/crm/raise-limit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key_prefix: prefix, monthly_limit: target }),
            });
            const data = (await r.json()) as { previous_limit?: number; message?: string };
            if (!r.ok) throw new Error(data.message ?? `HTTP ${r.status}`);
            setMessage(`(avant : ${data.previous_limit ?? currentLimit})`);
            setState('done');
          } catch (e) {
            setMessage(e instanceof Error ? e.message : 'échec');
            setState('error');
          }
        }}
        className="rounded border border-emerald-500/50 px-2.5 py-1 text-[12px] font-medium text-emerald-400 transition-colors hover:bg-emerald-500/10 disabled:opacity-40"
      >
        {state === 'busy' ? 'Relèvement…' : 'Relever le plafond'}
      </button>
      {state === 'error' && <span className="text-[12px] text-red-300">échec : {message}</span>}
    </div>
  );
}
