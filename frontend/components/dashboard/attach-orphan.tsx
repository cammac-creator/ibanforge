'use client';

import { useEffect, useRef, useState } from 'react';
import { suggestFor, type PersonRow } from '@/lib/crm/orphan-suggest';

/**
 * The two gestures that let the orphan queue empty:
 *
 * - "this orphan IS that customer" — registers the sender as an alias of the
 *   canonical address (honoured by the write endpoints and the VPS sync's
 *   known-address net), then resolves the orphan. From the next sync run the
 *   sender's whole thread folds into the customer's file, forever.
 * - "this is nobody's mail" — resolves the orphan with no alias, for the mail
 *   that is legitimately not a customer (an authority answering one of our
 *   permission letters, a newsletter). Without this exit the queue could only
 *   grow, and a queue that cannot reach zero stops being read.
 *
 * The canonical address is picked from the CRM's people index, not recalled
 * from memory: the operator is looking at an UNKNOWN address, so the one thing
 * they cannot be asked for is the known one. Free typing stays possible — the
 * index can lag reality — but an address the index does not know is flagged
 * before it is confirmed.
 */

// Module-level caches: one fetch per browser session, shared by every control.
// They survive soft navigations, so a person added to the CRM mid-session only
// appears after a hard reload — accepted, because suggestions and warnings are
// advisory and degrade to free typing. A failed fetch nulls the slot so the
// next control (or this one, reopened) retries instead of caching the miss.
let indexPromise: Promise<PersonRow[]> | null = null;
let aliasesPromise: Promise<Map<string, string>> | null = null;

function loadIndex(): Promise<PersonRow[]> {
  indexPromise ??= fetch('/api/crm/search-index')
    .then(async (r) => {
      if (!r.ok) throw new Error(`index HTTP ${r.status}`);
      const data = (await r.json()) as { rows?: PersonRow[] };
      return data.rows ?? [];
    })
    .catch((e: unknown) => {
      indexPromise = null;
      throw e instanceof Error ? e : new Error('index');
    });
  return indexPromise;
}

function loadAliases(): Promise<Map<string, string>> {
  aliasesPromise ??= fetch('/api/crm/email-aliases')
    .then(async (r) => {
      if (!r.ok) throw new Error(`aliases HTTP ${r.status}`);
      const data = (await r.json()) as { aliases?: Array<{ alias: string; canonical: string }> };
      return new Map((data.aliases ?? []).map((a) => [a.alias, a.canonical]));
    })
    .catch((e: unknown) => {
      aliasesPromise = null;
      throw e instanceof Error ? e : new Error('aliases');
    });
  return aliasesPromise;
}

type Mode = 'closed' | 'attach' | 'dismiss';
type Busy = 'idle' | 'busy' | 'error';

export function AttachOrphanControl({ orphanId, sender }: { orphanId: string; sender: string }) {
  const [mode, setMode] = useState<Mode>('closed');
  const [canonical, setCanonical] = useState('');
  const [armed, setArmed] = useState(false);
  // A plain double-click must not count as arm + confirm: the two clicks land
  // on the same button, and the state update from the first is committed
  // before the second event runs. The pause is what makes the second click a
  // decision instead of a reflex — the native confirm this replaced imposed
  // one by construction.
  const armedAtRef = useRef(0);
  const [busy, setBusy] = useState<Busy>('idle');
  const [message, setMessage] = useState('');
  const [rows, setRows] = useState<PersonRow[] | 'failed' | null>(null);
  const [knownAlias, setKnownAlias] = useState<string | null>(null);
  const [done, setDone] = useState<{ kind: 'attached'; to: string } | { kind: 'dismissed' } | null>(null);

  useEffect(() => {
    if (mode !== 'attach' || rows !== null) return;
    let alive = true;
    loadIndex().then(
      (r) => alive && setRows(r),
      () => alive && setRows('failed'),
    );
    loadAliases().then(
      (m) => alive && setKnownAlias(m.get(sender) ?? null),
      () => alive && setKnownAlias(null),
    );
    return () => {
      alive = false;
    };
  }, [mode, rows, sender]);

  if (done?.kind === 'attached') {
    return (
      <p aria-live="polite" className="mt-1 text-[12px] text-emerald-400">
        ✓ {sender} rattaché à {done.to} — son fil complet remonte au prochain passage de la synchro (horaire).
      </p>
    );
  }
  if (done?.kind === 'dismissed') {
    return (
      <p aria-live="polite" className="mt-1 text-[12px] text-[var(--fg-3)]">
        ✓ Classé sans rattachement — il ne reviendra pas.
      </p>
    );
  }

  if (mode === 'closed') {
    return (
      <div className="mt-1 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setMode('attach');
            // A previous index failure must not freeze this control in the
            // degraded state forever: reopening retries the fetch.
            if (rows === 'failed') setRows(null);
          }}
          className="rounded border border-amber-500/40 px-2 py-1 text-[12px] font-medium text-amber-400 hover:bg-amber-500/10"
        >
          Rattacher à un client…
        </button>
        <button
          type="button"
          onClick={() => setMode('dismiss')}
          className="rounded border border-[var(--ink-4)] px-2 py-1 text-[12px] text-[var(--fg-3)] hover:text-[var(--fg-1)]"
        >
          Classer sans rattacher
        </button>
      </div>
    );
  }

  const reset = () => {
    setMode('closed');
    setArmed(false);
    setBusy('idle');
    setMessage('');
  };

  const clearFailure = () => {
    if (busy === 'error') {
      setBusy('idle');
      setMessage('');
    }
  };

  async function post(path: string, body: unknown): Promise<unknown> {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data: unknown = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (data as { message?: string }).message;
      throw new Error(msg ?? `HTTP ${r.status}`);
    }
    return data;
  }

  if (mode === 'dismiss') {
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-[var(--fg-3)]">
          Classer ce mail sans le relier à personne (autorité, avis automatique…) ?
        </span>
        <button
          type="button"
          disabled={busy === 'busy'}
          onClick={async () => {
            setBusy('busy');
            try {
              await post('/api/crm/orphan-resolve', { id: orphanId });
              setDone({ kind: 'dismissed' });
            } catch (e) {
              setMessage(e instanceof Error ? e.message : 'échec');
              setBusy('error');
            }
          }}
          className="rounded border border-[var(--ink-4)] px-2.5 py-1 text-[12px] font-medium text-[var(--fg-2)] hover:bg-[var(--ink-4)]/40 disabled:opacity-40"
        >
          {busy === 'busy' ? 'Classement…' : 'Oui, classer'}
        </button>
        <button type="button" onClick={reset} className="rounded px-1.5 py-1 text-[12px] text-[var(--fg-4)] hover:text-[var(--fg-2)]">
          annuler
        </button>
        {busy === 'error' && (
          <span aria-live="polite" className="w-full text-[12px] text-red-300">
            échec : {message}
          </span>
        )}
      </div>
    );
  }

  // mode === 'attach'
  const cleaned = canonical.trim().toLowerCase();
  const valid = cleaned.includes('@') && cleaned !== sender;
  const suggestions = Array.isArray(rows) ? suggestFor(sender, canonical, rows).filter((r) => r.email !== sender) : [];
  const addressKnown = !Array.isArray(rows) || rows.length === 0 || rows.some((r) => r.email === cleaned);

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          autoComplete="off"
          aria-label="Client à rattacher : nom, société ou adresse"
          value={canonical}
          onChange={(e) => {
            setCanonical(e.target.value);
            setArmed(false);
            clearFailure();
          }}
          placeholder="nom, société ou adresse…"
          className="min-w-0 flex-1 rounded border border-[var(--ink-4)] bg-[var(--ink-0)] px-2 py-1.5 text-base text-[var(--fg-1)] placeholder:text-[var(--fg-5)] focus:border-amber-500/50 focus:outline-none sm:max-w-[280px] sm:text-[12.5px]"
        />
        <button
          type="button"
          disabled={busy === 'busy' || !valid}
          onClick={async () => {
            if (!armed) {
              setArmed(true);
              armedAtRef.current = Date.now();
              return;
            }
            if (Date.now() - armedAtRef.current < 400) return;
            setBusy('busy');
            try {
              const aliasReply = (await post('/api/crm/email-aliases', { alias: sender, canonical: cleaned })) as {
                aliases?: Array<{ alias: string; canonical: string }>;
              };
              // The server resolves alias chains; its answer, not the typed
              // address, is what resolved_as must record — a later reader of
              // resolved_as trusts it over re-deciding.
              const resolved = aliasReply.aliases?.find((a) => a.alias === sender)?.canonical ?? cleaned;
              await post('/api/crm/orphan-resolve', { id: orphanId, attached_to: resolved });
              setDone({ kind: 'attached', to: resolved });
            } catch (e) {
              setMessage(e instanceof Error ? e.message : 'échec');
              setBusy('error');
              setArmed(false);
            }
          }}
          className={`rounded border px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-40 ${
            armed
              ? 'border-emerald-400 bg-emerald-500/15 text-emerald-300'
              : 'border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10'
          }`}
        >
          {busy === 'busy' ? 'Rattachement…' : armed ? 'Oui, ils ne font qu’un' : 'Rattacher'}
        </button>
        <button type="button" onClick={reset} className="rounded px-1.5 py-1 text-[12px] text-[var(--fg-4)] hover:text-[var(--fg-2)]">
          annuler
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s.email}
              type="button"
              onClick={() => {
                setCanonical(s.email);
                setArmed(false);
                clearFailure();
              }}
              className={`rounded border px-2 py-1 text-[11.5px] ${
                cleaned === s.email
                  ? 'border-amber-400 bg-amber-500/15 text-amber-300'
                  : 'border-[var(--ink-4)] text-[var(--fg-2)] hover:border-amber-500/40 hover:text-amber-300'
              }`}
            >
              {s.email}
              <span className="ml-1.5 text-[var(--fg-4)]">
                {s.label} · {s.kind === 'client' ? 'client' : 'prospect'}
              </span>
            </button>
          ))}
        </div>
      )}
      {Array.isArray(rows) && rows.length > 0 && suggestions.length === 0 && (
        <p className="mt-1 text-[11.5px] text-[var(--fg-4)]">
          Aucune correspondance dans le CRM — tape un nom, une société ou une adresse.
        </p>
      )}
      {rows === 'failed' && (
        <p className="mt-1 text-[11.5px] text-amber-300">
          L&apos;index CRM n&apos;a pas répondu : pas de suggestions ni de garde-fou d&apos;adresse inconnue.
          Saisie libre possible ; rouvre le formulaire pour réessayer.
        </p>
      )}

      <div aria-live="polite">
        {armed && (
          <p className="mt-1.5 text-[12px] text-emerald-300">
            Déclarer que <strong>{sender}</strong> est la même personne que <strong>{cleaned}</strong> — son fil
            fusionnera dans ce dossier.
            {knownAlias && knownAlias !== cleaned && (
              <strong className="text-amber-300"> ⚠ {sender} est déjà rattaché à {knownAlias} ; confirmer le re-rattache.</strong>
            )}{' '}
            Reclique pour confirmer.
          </p>
        )}
        {valid && Array.isArray(rows) && rows.length > 0 && !addressKnown && (
          <p className="mt-1 text-[11.5px] text-amber-300">
            ⚠ {cleaned} n&apos;est ni un détenteur de clé ni un prospect connu du CRM — vérifie avant de confirmer.
          </p>
        )}
        {busy === 'error' && <p className="mt-1 text-[12px] text-red-300">échec : {message}</p>}
      </div>
    </div>
  );
}
