'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Forums tab: community threads worth answering + marketplace presence.
 *
 * The operator reads French (summaries, chrome), the DRAFT is in the thread's
 * language: the two concerns are separate fields, never mixed. Everything
 * heavier than a click-through goes through the backend via the /api/crm
 * proxies; this component holds no secret.
 */

interface ForumThread {
  id: number;
  url: string;
  source: string;
  title: string;
  excerpt: string | null;
  lang: string;
  score: number;
  score_detail: string | null;
  activity: string | null;
  thread_created_at: string | null;
  status: string;
  planned_for: string | null;
  draft: string | null;
  summary_fr: string | null;
  posted_url: string | null;
  notes: string | null;
  first_seen: string;
  updated_at: string;
}

interface Marketplace {
  slug: string;
  name: string;
  url: string;
  action_url: string | null;
  status: string;
  detail: string | null;
  auto: number;
  checked_at: string | null;
  notes: string | null;
}

interface ScanInfo {
  last_scan_at: string | null;
  scanning: boolean;
  last_report: {
    finished_at: string;
    threads: { inserted: number; seen: number; refreshed: number };
    marketplaces: { checked: number; skipped: number };
    errors: string[];
  } | null;
}

const STATUS_LABELS: Record<string, string> = {
  new: 'Nouveau',
  to_answer: 'À répondre',
  drafted: 'Brouillon prêt',
  planned: 'Planifié',
  posted: 'Répondu',
  dismissed: 'Écarté',
};
const STATUS_ORDER = ['new', 'to_answer', 'drafted', 'planned', 'posted', 'dismissed'];
const ACTIVE_STATUSES = new Set(['new', 'to_answer', 'drafted', 'planned']);

const SOURCE_LABELS: Record<string, string> = {
  stackoverflow: 'Stack Overflow',
  money_se: 'Money SE',
  github: 'GitHub',
  hn: 'Hacker News',
  reddit: 'Reddit',
  manual: 'Manuel',
};

const LANG_LABELS: Record<string, string> = { en: 'EN', de: 'DE', fr: 'FR' };

const PRESENCE_BADGE: Record<string, { label: string; cls: string }> = {
  listed: { label: 'Listé', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  pending: { label: 'En attente', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  absent: { label: 'Absent', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  dead: { label: 'Mort', cls: 'bg-[var(--ink-4)]/60 text-[var(--fg-4)] border-[var(--ink-4)] line-through' },
  manual: { label: 'Manuel', cls: 'bg-[var(--ink-4)]/60 text-[var(--fg-3)] border-[var(--ink-4)]' },
  unknown: { label: 'À vérifier', cls: 'bg-[var(--ink-4)]/60 text-[var(--fg-4)] border-[var(--ink-4)]' },
};

function scoreCls(score: number): string {
  if (score >= 60) return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
  if (score >= 45) return 'bg-[var(--ink-4)]/80 text-[var(--fg-2)] border-[var(--ink-4)]';
  return 'bg-[var(--ink-4)]/50 text-[var(--fg-4)] border-[var(--ink-4)]';
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }
}

export function ForumsApp() {
  const [threads, setThreads] = useState<ForumThread[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [scan, setScan] = useState<ScanInfo | null>(null);
  const [markets, setMarkets] = useState<Marketplace[]>([]);
  const [filter, setFilter] = useState<string>('active');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [edit, setEdit] = useState<Partial<ForumThread>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const say = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const loadThreads = useCallback(async () => {
    try {
      const r = await fetch('/api/crm/forum-threads');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { threads: ForumThread[]; counts: Record<string, number>; scan: ScanInfo };
      setThreads(data.threads ?? []);
      setCounts(data.counts ?? {});
      setScan(data.scan ?? null);
      setLoadError(null);
      return data.scan;
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'chargement impossible');
      return null;
    }
  }, []);

  const loadMarkets = useCallback(async () => {
    try {
      const r = await fetch('/api/crm/forum-marketplaces');
      if (!r.ok) return;
      const data = (await r.json()) as { marketplaces: Marketplace[] };
      setMarkets(data.marketplaces ?? []);
    } catch {
      /* the threads error banner already covers connectivity */
    }
  }, []);

  useEffect(() => {
    void loadThreads();
    void loadMarkets();
  }, [loadThreads, loadMarkets]);

  // While a scan runs, poll until it finishes (bounded: the interval clears
  // itself as soon as scanning goes false).
  useEffect(() => {
    if (scan?.scanning && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        const s = await loadThreads();
        void loadMarkets();
        if (!s?.scanning && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          say('Scan terminé.');
        }
      }, 5000);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [scan?.scanning, loadThreads, loadMarkets, say]);

  const visible = useMemo(() => {
    if (filter === 'all') return threads;
    if (filter === 'active') return threads.filter((t) => ACTIVE_STATUSES.has(t.status));
    return threads.filter((t) => t.status === filter);
  }, [threads, filter]);

  const selected = useMemo(() => threads.find((t) => t.id === selectedId) ?? null, [threads, selectedId]);

  const select = useCallback((t: ForumThread) => {
    setSelectedId(t.id);
    setEdit({
      status: t.status,
      lang: t.lang,
      draft: t.draft ?? '',
      summary_fr: t.summary_fr ?? '',
      planned_for: t.planned_for ?? '',
      posted_url: t.posted_url ?? '',
      notes: t.notes ?? '',
    });
    setDirty(false);
  }, []);

  const save = useCallback(
    async (extra?: Partial<ForumThread>) => {
      if (!selected) return;
      setBusy('save');
      try {
        const payload = { ...edit, ...extra };
        const r = await fetch(`/api/crm/forum-threads?id=${selected.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const { thread } = (await r.json()) as { thread: ForumThread };
        setThreads((all) => all.map((t) => (t.id === thread.id ? thread : t)));
        setEdit((e) => ({ ...e, ...extra }));
        setDirty(false);
        say('Enregistré.');
      } catch {
        say("Échec de l'enregistrement.");
      } finally {
        setBusy(null);
      }
    },
    [selected, edit, say],
  );

  const generate = useCallback(async () => {
    if (!selected) return;
    setBusy('generate');
    try {
      const r = await fetch('/api/crm/forum-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: selected.title,
          excerpt: selected.excerpt ?? '',
          url: selected.url,
          lang: edit.lang ?? selected.lang,
          source: selected.source,
          notes: edit.notes ?? '',
        }),
      });
      const data = (await r.json()) as { draft?: string; summary_fr?: string; message?: string };
      if (!r.ok) {
        say(data.message ?? 'Génération impossible.');
        return;
      }
      setEdit((e) => ({ ...e, draft: data.draft ?? '', summary_fr: data.summary_fr ?? '', status: 'drafted' }));
      setDirty(true);
      say('Brouillon généré, relis puis enregistre.');
    } catch {
      say('Génération impossible (réseau).');
    } finally {
      setBusy(null);
    }
  }, [selected, edit.lang, edit.notes, say]);

  const runScan = useCallback(
    async (what: 'threads' | 'marketplaces') => {
      setBusy(what);
      try {
        const r = await fetch('/api/crm/forum-scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ what }),
        });
        const data = (await r.json()) as { started?: boolean; reason?: string };
        if (data.started) {
          say(what === 'threads' ? 'Scan des forums lancé…' : 'Vérification des marketplaces lancée…');
          setScan((s) => (s ? { ...s, scanning: true } : s));
        } else {
          say(data.reason ?? 'Scan refusé.');
        }
      } catch {
        say('Impossible de lancer le scan.');
      } finally {
        setBusy(null);
      }
    },
    [say],
  );

  const saveMarketNotes = useCallback(
    async (slug: string, notes: string) => {
      try {
        const r = await fetch(`/api/crm/forum-marketplaces?slug=${encodeURIComponent(slug)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes }),
        });
        if (r.ok) {
          const { marketplace } = (await r.json()) as { marketplace: Marketplace };
          setMarkets((all) => all.map((m) => (m.slug === slug ? marketplace : m)));
        }
      } catch {
        /* keep the local text, the operator can retry */
      }
    },
    [],
  );

  const activeCount = STATUS_ORDER.filter((s) => ACTIVE_STATUSES.has(s)).reduce((a, s) => a + (counts[s] ?? 0), 0);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {/* Header line, same grammar as the Contacts tab. */}
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h1 className="text-base font-semibold text-white">Forums</h1>
        <p className="text-sm text-[var(--fg-3)]">
          <span className="text-amber-400">
            {activeCount} fil{activeCount > 1 ? 's' : ''} à traiter
          </span>
          {' · '}
          {counts.posted ?? 0} répondu{(counts.posted ?? 0) > 1 ? 's' : ''}
          {' · '}
          {scan?.last_scan_at ? `dernier scan ${scan.last_scan_at.slice(0, 16).replace('T', ' ')}` : 'jamais scanné'}
          {scan?.scanning ? ' · scan en cours…' : ''}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => void runScan('threads')}
            disabled={busy !== null || scan?.scanning === true}
            className="rounded border border-[var(--ink-4)] px-3 py-1.5 text-xs font-medium text-[var(--fg-2)] transition-colors hover:bg-[var(--ink-4)]/50 disabled:opacity-40"
          >
            Scanner les forums
          </button>
          <button
            onClick={() => void runScan('marketplaces')}
            disabled={busy !== null || scan?.scanning === true}
            className="rounded border border-[var(--ink-4)] px-3 py-1.5 text-xs font-medium text-[var(--fg-2)] transition-colors hover:bg-[var(--ink-4)]/50 disabled:opacity-40"
          >
            Vérifier les marketplaces
          </button>
        </div>
      </div>

      {toast && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          {toast}
        </div>
      )}
      {loadError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          Chargement impossible ({loadError}) : API injoignable ou secrets absents.
        </div>
      )}
      {scan?.last_report && scan.last_report.errors.length > 0 && !scan.scanning && (
        <div className="rounded-lg border border-[var(--ink-4)] bg-[var(--ink-2)]/60 px-3 py-2 text-xs text-[var(--fg-3)]">
          Dernier scan : {scan.last_report.threads.inserted} nouveau(x) fil(s), {scan.last_report.marketplaces.checked}{' '}
          place(s) vérifiée(s) · sondes en échec : {scan.last_report.errors.join(' · ')}
        </div>
      )}

      {/* Status filter chips. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {[
          { key: 'active', label: `À traiter (${activeCount})` },
          ...STATUS_ORDER.map((s) => ({ key: s, label: `${STATUS_LABELS[s]} (${counts[s] ?? 0})` })),
          { key: 'all', label: 'Tous' },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={[
              'rounded px-2.5 py-1 text-xs font-medium transition-colors',
              filter === f.key
                ? 'border border-amber-500/30 bg-amber-500/15 text-amber-400'
                : 'border border-transparent text-[var(--fg-4)] hover:text-[var(--fg-2)]',
            ].join(' ')}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        {/* Thread list */}
        <div className="flex min-w-0 flex-col gap-2">
          {visible.length === 0 && (
            <div className="rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 p-6 text-center text-sm text-[var(--fg-3)]">
              Rien dans ce filtre. Lance « Scanner les forums » pour remplir la liste.
            </div>
          )}
          {visible.map((t) => (
            <button
              key={t.id}
              onClick={() => select(t)}
              className={[
                'rounded-xl border p-3 text-left transition-colors',
                t.id === selectedId
                  ? 'border-amber-500/40 bg-amber-500/5'
                  : 'border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 hover:border-[var(--ink-4)]',
              ].join(' ')}
            >
              <div className="flex items-center gap-2">
                <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${scoreCls(t.score)}`}>
                  {t.score}
                </span>
                <span className="text-[11px] text-[var(--fg-4)]">{SOURCE_LABELS[t.source] ?? t.source}</span>
                <span className="rounded border border-[var(--ink-4)] px-1 py-0.5 font-mono text-[9px] text-[var(--fg-4)]">
                  {LANG_LABELS[t.lang] ?? t.lang}
                </span>
                <span className="ml-auto text-[11px] text-[var(--fg-4)]">
                  {STATUS_LABELS[t.status] ?? t.status}
                  {t.planned_for ? ` · ${t.planned_for}` : ''}
                </span>
              </div>
              <p className="mt-1.5 line-clamp-2 text-sm font-medium text-[var(--fg-2)]">{t.title}</p>
              <p className="mt-1 text-[11px] text-[var(--fg-4)]">
                {t.activity ?? ''}
                {t.thread_created_at ? ` · ${t.thread_created_at}` : ''}
              </p>
            </button>
          ))}
        </div>

        {/* Detail pane */}
        <div className="min-w-0">
          {!selected ? (
            <div className="rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 p-8 text-center text-sm text-[var(--fg-3)]">
              Choisis un fil à gauche : lien, résumé FR, brouillon à copier et suivi vivent ici.
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0">
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold text-white underline decoration-[var(--ink-4)] underline-offset-4 hover:decoration-amber-400"
                  >
                    {selected.title} ↗
                  </a>
                  <p className="mt-1 text-[11px] text-[var(--fg-4)]">
                    {SOURCE_LABELS[selected.source] ?? selected.source} · {selected.activity ?? ''} · pertinence{' '}
                    {selected.score} ({selected.score_detail ?? ''})
                  </p>
                </div>
              </div>

              {selected.excerpt && (
                <p className="rounded-lg bg-[var(--ink-0)]/60 p-2.5 text-xs leading-relaxed text-[var(--fg-3)]">
                  {selected.excerpt}
                </p>
              )}

              <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--fg-4)]">
                Résumé pour toi (FR)
                <textarea
                  value={String(edit.summary_fr ?? '')}
                  onChange={(e) => {
                    setEdit((x) => ({ ...x, summary_fr: e.target.value }));
                    setDirty(true);
                  }}
                  rows={2}
                  placeholder="Ce que demande le fil, et l'angle de notre réponse."
                  className="mt-1 w-full rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)]/60 p-2 text-sm text-[var(--fg-2)] placeholder:text-[var(--fg-4)] focus:border-amber-500/50 focus:outline-none"
                />
              </label>

              <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--fg-4)]">
                <span className="flex items-center gap-2">
                  Brouillon de réponse
                  <select
                    value={String(edit.lang ?? selected.lang)}
                    onChange={(e) => {
                      setEdit((x) => ({ ...x, lang: e.target.value }));
                      setDirty(true);
                    }}
                    className="rounded border border-[var(--ink-4)] bg-[var(--ink-0)] px-1.5 py-0.5 text-[11px] text-[var(--fg-2)]"
                  >
                    <option value="en">EN</option>
                    <option value="de">DE</option>
                    <option value="fr">FR</option>
                  </select>
                  <span className="normal-case text-[var(--fg-4)]">(langue du correspondant)</span>
                </span>
                <textarea
                  value={String(edit.draft ?? '')}
                  onChange={(e) => {
                    setEdit((x) => ({ ...x, draft: e.target.value }));
                    setDirty(true);
                  }}
                  rows={10}
                  placeholder="Le texte prêt à coller sur la plateforme, dans la langue du fil."
                  className="mt-1 w-full rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)]/60 p-2 font-mono text-xs leading-relaxed text-[var(--fg-2)] placeholder:text-[var(--fg-4)] focus:border-amber-500/50 focus:outline-none"
                />
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={async () => {
                    const ok = await copyToClipboard(String(edit.draft ?? ''));
                    say(ok ? 'Brouillon copié.' : 'Copie refusée par le navigateur.');
                  }}
                  disabled={!String(edit.draft ?? '').trim()}
                  className="rounded bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-40"
                >
                  Copier le brouillon
                </button>
                <button
                  onClick={() => void generate()}
                  disabled={busy !== null}
                  className="rounded border border-[var(--ink-4)] px-3 py-1.5 text-xs font-medium text-[var(--fg-2)] transition-colors hover:bg-[var(--ink-4)]/50 disabled:opacity-40"
                >
                  {busy === 'generate' ? 'Génération…' : 'Générer (IA, ton solutionneur)'}
                </button>
                <button
                  onClick={() => void save()}
                  disabled={busy !== null || !dirty}
                  className="rounded border border-emerald-500/40 px-3 py-1.5 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/10 disabled:opacity-40"
                >
                  {busy === 'save' ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'Enregistré ✓'}
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--fg-4)]">
                  Statut
                  <select
                    value={String(edit.status ?? selected.status)}
                    onChange={(e) => {
                      setEdit((x) => ({ ...x, status: e.target.value }));
                      setDirty(true);
                    }}
                    className="mt-1 w-full rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)]/60 p-2 text-sm text-[var(--fg-2)]"
                  >
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--fg-4)]">
                  Planifié pour
                  <input
                    type="date"
                    value={String(edit.planned_for ?? '')}
                    onChange={(e) => {
                      setEdit((x) => ({ ...x, planned_for: e.target.value, status: e.target.value ? 'planned' : x.status }));
                      setDirty(true);
                    }}
                    className="mt-1 w-full rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)]/60 p-2 text-sm text-[var(--fg-2)]"
                  />
                </label>
                <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--fg-4)]">
                  URL de ma réponse
                  <input
                    type="url"
                    value={String(edit.posted_url ?? '')}
                    onChange={(e) => {
                      setEdit((x) => ({ ...x, posted_url: e.target.value, status: e.target.value ? 'posted' : x.status }));
                      setDirty(true);
                    }}
                    placeholder="collée ici une fois publiée"
                    className="mt-1 w-full rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)]/60 p-2 text-sm text-[var(--fg-2)] placeholder:text-[var(--fg-4)]"
                  />
                </label>
              </div>

              <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--fg-4)]">
                Notes
                <textarea
                  value={String(edit.notes ?? '')}
                  onChange={(e) => {
                    setEdit((x) => ({ ...x, notes: e.target.value }));
                    setDirty(true);
                  }}
                  rows={2}
                  placeholder="Contexte privé (jamais publié) : vérifs faites, angle, précautions."
                  className="mt-1 w-full rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)]/60 p-2 text-sm text-[var(--fg-2)] placeholder:text-[var(--fg-4)] focus:border-amber-500/50 focus:outline-none"
                />
              </label>

              <div className="flex items-center justify-between border-t border-[var(--ink-4)]/60 pt-2">
                <p className="text-[10px] text-[var(--fg-4)]">
                  Règles : répondre au problème d&apos;abord, divulguer l&apos;affiliation, citer une alternative,
                  zéro ton commercial. Jamais deux posts le même jour sur la même plateforme.
                </p>
                <button
                  onClick={() => void save({ status: 'dismissed' })}
                  disabled={busy !== null}
                  className="shrink-0 rounded border border-[var(--ink-4)] px-2.5 py-1 text-[11px] text-[var(--fg-4)] transition-colors hover:text-[var(--fg-2)]"
                >
                  Écarter ce fil
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Marketplace presence */}
      <div className="mt-2 flex min-w-0 flex-col gap-2">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-sm font-semibold text-white">Marketplaces &amp; annuaires</h2>
          <p className="text-xs text-[var(--fg-4)]">
            où IBANforge est visible, où il manque : vérifié automatiquement par le radar quotidien
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--ink-4)]/60 text-[10px] uppercase tracking-wide text-[var(--fg-4)]">
                <th className="px-3 py-2 font-medium">Statut</th>
                <th className="px-3 py-2 font-medium">Surface</th>
                <th className="px-3 py-2 font-medium">Détail</th>
                <th className="px-3 py-2 font-medium">Vérifié</th>
                <th className="px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {markets.map((m) => {
                const badge = PRESENCE_BADGE[m.status] ?? PRESENCE_BADGE.unknown;
                return (
                  <tr key={m.slug} className="border-b border-[var(--ink-4)]/30 last:border-0">
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <a
                        href={m.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--fg-2)] underline decoration-[var(--ink-4)] underline-offset-2 hover:decoration-amber-400"
                      >
                        {m.name}
                      </a>
                      {m.action_url && m.action_url !== m.url && (
                        <a
                          href={m.action_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 text-[10px] text-amber-400/80 hover:text-amber-400"
                        >
                          agir ↗
                        </a>
                      )}
                    </td>
                    <td className="max-w-[260px] px-3 py-2 text-xs text-[var(--fg-3)]">{m.detail ?? ''}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[10px] text-[var(--fg-4)]">
                      {m.checked_at ? m.checked_at.slice(0, 16).replace('T', ' ') : 'jamais'}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        defaultValue={m.notes ?? ''}
                        onBlur={(e) => {
                          if (e.target.value !== (m.notes ?? '')) void saveMarketNotes(m.slug, e.target.value);
                        }}
                        placeholder="note…"
                        className="w-full min-w-[140px] rounded border border-transparent bg-transparent p-1 text-xs text-[var(--fg-3)] placeholder:text-[var(--fg-4)]/60 focus:border-[var(--ink-4)] focus:bg-[var(--ink-0)]/60 focus:outline-none"
                      />
                    </td>
                  </tr>
                );
              })}
              {markets.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-[var(--fg-3)]">
                    Liste vide : le radar la remplit au premier tick (ou lance « Vérifier les marketplaces »).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
