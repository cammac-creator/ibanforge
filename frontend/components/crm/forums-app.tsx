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
  draft_fr: string | null;
  summary_fr: string | null;
  posted_url: string | null;
  notes: string | null;
  needs_attention: number;
  posted_at: string | null;
  first_seen: string;
  updated_at: string;
}

interface MarketplaceEvent {
  id: number;
  slug: string;
  from_status: string;
  to_status: string;
  detail: string | null;
  created_at: string;
}

/**
 * The fallback when the API serves no `platform_limits` block (audit TABS-16,
 * 2026-09-01).
 *
 * It used to be the only copy, identical to the byte to the backend's own
 * PLATFORM_LIMITS and linked to it by nothing, so raising a ceiling on one side
 * left the composer counting against a limit the poster no longer enforced. The
 * served table now wins; this stays because Vercel and Railway ship
 * independently, and a frontend running ahead of its API must still count.
 */
const CHAR_LIMITS: Record<string, { max: number | null; comfy: number }> = {
  stackoverflow: { max: 30_000, comfy: 2_500 },
  money_se: { max: 30_000, comfy: 2_500 },
  github: { max: 65_536, comfy: 2_500 },
  reddit: { max: 10_000, comfy: 2_500 },
  hn: { max: null, comfy: 2_000 },
  discourse: { max: 32_000, comfy: 2_500 },
  odoo: { max: null, comfy: 2_500 },
  manual: { max: null, comfy: 3_000 },
};

type CharLimits = Record<string, { max: number | null; comfy: number }>;

type ThreadSort = 'relevance' | 'date' | 'status';

const SORT_LABELS: Array<{ key: ThreadSort; label: string; title: string }> = [
  { key: 'relevance', label: 'Pertinence', title: 'l’ordre du radar : ce qui appelle une réponse d’abord' },
  { key: 'date', label: 'Date du post', title: 'les fils les plus récents en tête' },
  { key: 'status', label: 'Statut', title: 'regroupés par étape du pipeline' },
];

/**
 * Three orders over one list (audit TABS-15, 2026-09-01).
 *
 * The order was fixed in SQL and the browser only ever filtered, so "cible les
 * posts récents" was served indirectly, by a bonus buried in the score. It is a
 * question about a column, and a column can be sorted.
 *
 * `relevance` returns the array untouched: the API's ORDER BY already is that
 * order, and re-deriving it here would be a second ranking rule one edit away
 * from disagreeing with the first.
 */
function sortThreads(list: ForumThread[], sort: ThreadSort): ForumThread[] {
  if (sort === 'relevance') return list;
  const copy = [...list];
  if (sort === 'date') {
    // thread_created_at is the post's own date and is what "récent" means;
    // first_seen, the day the radar noticed it, is the fallback. Undatable rows
    // sink rather than float: an unknown date is not a fresh one.
    const at = (t: ForumThread) => {
      const raw = t.thread_created_at ?? t.first_seen;
      const ms = raw ? Date.parse(raw) : NaN;
      return Number.isNaN(ms) ? -Infinity : ms;
    };
    return copy.sort((a, b) => at(b) - at(a) || b.score - a.score);
  }
  const rank = (t: ForumThread) => {
    const i = STATUS_ORDER.indexOf(t.status);
    return i === -1 ? STATUS_ORDER.length : i;
  };
  return copy.sort((a, b) => rank(a) - rank(b) || b.score - a.score);
}

function charCounter(
  len: number,
  source: string,
  served?: CharLimits,
): { text: string; cls: string; over: boolean } {
  const table = served ?? CHAR_LIMITS;
  const lim = table[source] ?? table.manual ?? CHAR_LIMITS.manual;
  const maxTxt = lim.max ? `${lim.max.toLocaleString('fr-CH')}` : 'sans limite dure';
  if (lim.max && len > lim.max) {
    return { text: `${len.toLocaleString('fr-CH')} / ${maxTxt} car. — DÉPASSE la limite`, cls: 'text-red-400', over: true };
  }
  if (len > lim.comfy) {
    return { text: `${len.toLocaleString('fr-CH')} car. (${maxTxt}) — long pour un forum`, cls: 'text-amber-400', over: false };
  }
  return { text: `${len.toLocaleString('fr-CH')} car. (max ${maxTxt})`, cls: 'text-[var(--fg-4)]', over: false };
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
    drafts?: { generated: number; failed: number };
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
  discourse: 'Forum (Discourse)',
  odoo: 'Forum Odoo',
  manual: 'Manuel',
};

/** A thread younger than two weeks is a live conversation. */
function isRecent(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const t = Date.parse(dateStr);
  return Number.isFinite(t) && Date.now() - t < 14 * 86_400_000;
}

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
  const [marketEvents, setMarketEvents] = useState<MarketplaceEvent[]>([]);
  const [filter, setFilter] = useState<string>('active');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [edit, setEdit] = useState<Partial<ForumThread>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Two rooms under one roof: the threads to answer, and the shop windows
  // (marketplaces & annuaires). The windows used to live as a page footer,
  // which buried them; they now hold a full pane of their own.
  const [pane, setPane] = useState<'threads' | 'markets'>('threads');
  // Pertinence is the order the API already returns, so the default costs
  // nothing and the two others are the questions the list could not answer
  // (audit TABS-15, 2026-09-01): "what came out this week" and "where am I in
  // the pipeline".
  const [sort, setSort] = useState<ThreadSort>('relevance');
  // The character ceilings as the API serves them (TABS-16). Undefined until
  // the first load answers, and undefined again against an API that does not
  // serve them yet: charCounter falls back to the local table either way.
  const [limits, setLimits] = useState<CharLimits | undefined>(undefined);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * One toast at a time, and none left standing after the component goes
   * (audit TABS-17, 2026-09-01). The timer used to be posted and forgotten: a
   * second message inside three seconds was wiped by the first one's timer, and
   * a component unmounted in between left a setState aimed at nothing.
   */
  const say = useCallback((msg: string) => {
    setToast(msg);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => {
      setToast(null);
      toastRef.current = null;
    }, 3500);
  }, []);

  useEffect(
    () => () => {
      if (toastRef.current) clearTimeout(toastRef.current);
    },
    [],
  );

  /**
   * `lean` asks for the list without the long text (audit TABS-18).
   *
   * Only the scan poll uses it, and the rows it brings back are merged OVER the
   * ones already held rather than replacing them: a lean row carries no draft,
   * and a poll landing mid-edit must not take the draft out from under the
   * detail pane. A thread the scan has just discovered simply arrives with no
   * draft yet, which is what it is.
   */
  const loadThreads = useCallback(async (lean = false) => {
    try {
      const r = await fetch(`/api/crm/forum-threads${lean ? '?fields=list' : ''}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as {
        threads: ForumThread[];
        counts: Record<string, number>;
        scan: ScanInfo;
        platform_limits?: CharLimits;
      };
      const incoming = data.threads ?? [];
      setThreads((prev) => {
        if (!lean) return incoming;
        const held = new Map(prev.map((t) => [t.id, t]));
        return incoming.map((t) => ({ ...(held.get(t.id) ?? ({} as ForumThread)), ...t }));
      });
      setCounts(data.counts ?? {});
      setScan(data.scan ?? null);
      if (data.platform_limits) setLimits(data.platform_limits);
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
      const data = (await r.json()) as { marketplaces: Marketplace[]; events?: MarketplaceEvent[] };
      setMarkets(data.marketplaces ?? []);
      setMarketEvents(data.events ?? []);
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
        const s = await loadThreads(true);
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
    const kept =
      filter === 'all'
        ? threads
        : filter === 'active'
          ? threads.filter((t) => ACTIVE_STATUSES.has(t.status))
          : threads.filter((t) => t.status === filter);
    return sortThreads(kept, sort);
  }, [threads, filter, sort]);

  const selected = useMemo(() => threads.find((t) => t.id === selectedId) ?? null, [threads, selectedId]);

  const select = useCallback((t: ForumThread) => {
    setSelectedId(t.id);
    // Phone layout swaps list for detail; land the user at the top of it.
    if (typeof window !== 'undefined' && window.innerWidth < 1024) window.scrollTo({ top: 0 });
    setEdit({
      status: t.status,
      lang: t.lang,
      draft: t.draft ?? '',
      draft_fr: t.draft_fr ?? '',
      summary_fr: t.summary_fr ?? '',
      posted_url: t.posted_url ?? '',
      notes: t.notes ?? '',
    });
    setDirty(false);
    // Opening a flagged thread acknowledges the "someone replied" badge.
    if (t.needs_attention === 1) {
      setThreads((all) => all.map((x) => (x.id === t.id ? { ...x, needs_attention: 0 } : x)));
      void fetch(`/api/crm/forum-threads?id=${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ needs_attention: 0 }),
      }).catch(() => undefined);
    }
  }, []);

  // One post per platform per day: the sources that already got one today
  // (UTC dates on both sides, close enough for a guardrail).
  const postedToday = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return new Set(threads.filter((t) => (t.posted_at ?? '').slice(0, 10) === today).map((t) => t.source));
  }, [threads]);

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
        {pane === 'threads' ? (
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
        ) : (
          <p className="text-sm text-[var(--fg-3)]">
            <span className="text-emerald-400">
              {markets.filter((m) => m.status === 'listed').length} listé
              {markets.filter((m) => m.status === 'listed').length > 1 ? 's' : ''}
            </span>
            {' · '}
            {markets.filter((m) => m.status === 'absent' || m.status === 'pending' || m.status === 'unknown').length} à
            conquérir
            {scan?.scanning ? ' · vérification en cours…' : ''}
          </p>
        )}
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          {pane === 'threads' ? (
            <button
              onClick={() => void runScan('threads')}
              disabled={busy !== null || scan?.scanning === true}
              className="flex-1 rounded border border-[var(--ink-4)] px-3 py-2.5 text-xs font-medium text-[var(--fg-2)] transition-colors hover:bg-[var(--ink-4)]/50 disabled:opacity-40 sm:flex-none sm:py-1.5"
            >
              Scanner les forums
            </button>
          ) : (
            <button
              onClick={() => void runScan('marketplaces')}
              disabled={busy !== null || scan?.scanning === true}
              className="flex-1 rounded border border-[var(--ink-4)] px-3 py-2.5 text-xs font-medium text-[var(--fg-2)] transition-colors hover:bg-[var(--ink-4)]/50 disabled:opacity-40 sm:flex-none sm:py-1.5"
            >
              Vérifier maintenant
            </button>
          )}
        </div>
      </div>

      {/* The two panes, one thumb-sized switch. The Vitrines badge counts the
          status changes of the last 7 days so a lost listing pulls the eye. */}
      <div className="flex items-center gap-1 self-start rounded-lg border border-[var(--ink-4)] p-1">
        {(
          [
            { key: 'threads' as const, label: `💬 Fils de discussion (${activeCount})` },
            { key: 'markets' as const, label: '🏪 Vitrines & annuaires' },
          ]
        ).map((p) => {
          const recentChanges =
            p.key === 'markets'
              ? marketEvents.filter((e) => Date.now() - Date.parse(e.created_at) < 7 * 86_400_000).length
              : 0;
          return (
            <button
              key={p.key}
              onClick={() => setPane(p.key)}
              className={[
                'flex items-center gap-1.5 rounded px-3 py-2 text-xs font-medium transition-colors sm:py-1.5',
                pane === p.key ? 'bg-[var(--ink-4)] text-white' : 'text-[var(--fg-4)] hover:text-[var(--fg-2)]',
              ].join(' ')}
            >
              {p.label}
              {recentChanges > 0 && (
                <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-300">
                  {recentChanges}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {toast && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          {toast}
        </div>
      )}
      {pane === 'threads' && postedToday.size > 0 && (
        <div className="rounded-lg border border-[var(--ink-4)] bg-[var(--ink-2)]/60 px-3 py-2 text-xs text-[var(--fg-3)]">
          ⏸ Déjà posté aujourd&apos;hui sur {[...postedToday].map((s) => SOURCE_LABELS[s] ?? s).join(', ')} — la règle
          anti-spam : jamais deux posts le même jour sur la même plateforme. Les autres fils de cette plateforme
          attendent demain.
        </div>
      )}
      {loadError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          Chargement impossible ({loadError}) : API injoignable ou secrets absents.
        </div>
      )}
      {pane === 'threads' && scan?.last_report && scan.last_report.errors.length > 0 && !scan.scanning && (
        <div className="rounded-lg border border-[var(--ink-4)] bg-[var(--ink-2)]/60 px-3 py-2 text-xs text-[var(--fg-3)]">
          Dernier scan : {scan.last_report.threads.inserted} nouveau(x) fil(s),{' '}
          {scan.last_report.drafts?.generated ?? 0} brouillon(s) généré(s), {scan.last_report.marketplaces.checked}{' '}
          place(s) vérifiée(s) · sondes en échec : {scan.last_report.errors.join(' · ')}
        </div>
      )}

      {pane === 'threads' && (
        <>
      {/* Status filter chips: one thumb-scrollable row on phones. */}
      <div className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:whitespace-normal">
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
        <span className="ml-auto flex shrink-0 items-center gap-0.5 rounded-md border border-[var(--ink-4)] p-0.5">
          {SORT_LABELS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              title={s.title}
              className={`rounded px-2 py-0.5 text-[11.5px] font-medium transition-colors ${
                sort === s.key ? 'bg-[var(--ink-4)] text-white' : 'text-[var(--fg-4)] hover:text-[var(--fg-2)]'
              }`}
            >
              {s.label}
            </button>
          ))}
        </span>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        {/* Thread list — on phones it yields the screen to the detail pane. */}
        <div className={`${selected ? 'hidden lg:flex' : 'flex'} min-w-0 flex-col gap-2`}>
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
                {t.needs_attention === 1 && (
                  <span className="rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                    💬 réponse reçue
                  </span>
                )}
                {isRecent(t.thread_created_at) && t.status !== 'posted' && t.status !== 'dismissed' && (
                  <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                    récent
                  </span>
                )}
                {postedToday.has(t.source) && t.status !== 'posted' && t.status !== 'dismissed' && (
                  <span
                    className="rounded border border-[var(--ink-4)] px-1.5 py-0.5 text-[10px] text-[var(--fg-4)]"
                    title="Un post est déjà parti aujourd'hui sur cette plateforme : attendre demain."
                  >
                    ⏸ demain
                  </span>
                )}
                <span className="ml-auto text-[11px] text-[var(--fg-4)]">
                  {STATUS_LABELS[t.status] ?? t.status}
                </span>
              </div>
              <p className="mt-1.5 line-clamp-2 text-sm font-medium text-[var(--fg-2)]">{t.title}</p>
              <p className="mt-1 text-[11px] text-[var(--fg-4)]">
                {t.activity ?? ''}
                {t.thread_created_at ? ` · posté ${t.thread_created_at}` : ''}
              </p>
            </button>
          ))}
        </div>

        {/* Detail pane */}
        <div className={`${selected ? 'block' : 'hidden lg:block'} min-w-0`}>
          {!selected ? (
            <div className="rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 p-8 text-center text-sm text-[var(--fg-3)]">
              Choisis un fil à gauche : lien, résumé FR, brouillon à copier et suivi vivent ici.
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 p-4">
              <button
                onClick={() => setSelectedId(null)}
                className="-mx-1 flex w-fit items-center gap-1 rounded px-2 py-1.5 text-sm font-medium text-amber-400 lg:hidden"
              >
                ← Retour aux fils
              </button>
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
                    {SOURCE_LABELS[selected.source] ?? selected.source}
                    {selected.thread_created_at ? ` · posté le ${selected.thread_created_at}` : ''} ·{' '}
                    {selected.activity ?? ''} · pertinence {selected.score} ({selected.score_detail ?? ''})
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
                  className="mt-1 w-full rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)]/60 p-2 text-base text-[var(--fg-2)] placeholder:text-[var(--fg-4)] focus:border-amber-500/50 focus:outline-none sm:text-sm"
                />
              </label>

              {(edit.lang ?? selected.lang) !== 'fr' ? (
                <>
                  {/* French first and big: this is what the operator READS.
                      The target-language text is real but secondary, folded. */}
                  <label className="text-[11px] font-medium uppercase tracking-wide text-amber-400/90">
                    Réponse — en français, pour te relire
                    <textarea
                      value={String(edit.draft_fr ?? '')}
                      onChange={(e) => {
                        setEdit((x) => ({ ...x, draft_fr: e.target.value }));
                        setDirty(true);
                      }}
                      rows={12}
                      placeholder="La traduction française arrive automatiquement (radar quotidien, ou « Scanner les forums »)."
                      className="mt-1 w-full rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)]/80 p-3 text-[16px] leading-relaxed text-[var(--fg-2)] placeholder:text-[var(--fg-4)] focus:border-amber-500/50 focus:outline-none sm:text-[15px]"
                    />
                  </label>

                  <details className="rounded-lg border border-[var(--ink-4)]/60 bg-[var(--ink-0)]/40">
                    <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--fg-4)] hover:text-[var(--fg-2)]">
                      Version {LANG_LABELS[String(edit.lang ?? selected.lang)] ?? '?'} — celle que le bouton copie ·{' '}
                      <span className={charCounter(String(edit.draft ?? '').length, selected.source, limits).cls}>
                        {charCounter(String(edit.draft ?? '').length, selected.source, limits).text}
                      </span>
                    </summary>
                    <div className="px-3 pb-3">
                      <div className="mb-1.5 flex items-center gap-2 text-[11px] text-[var(--fg-4)]">
                        Langue du correspondant :
                        <select
                          value={String(edit.lang ?? selected.lang)}
                          onChange={(e) => {
                            setEdit((x) => ({ ...x, lang: e.target.value }));
                            setDirty(true);
                          }}
                          className="rounded border border-[var(--ink-4)] bg-[var(--ink-0)] px-1.5 py-0.5 text-base text-[var(--fg-2)] sm:text-[11px]"
                        >
                          <option value="en">EN</option>
                          <option value="de">DE</option>
                          <option value="fr">FR</option>
                        </select>
                      </div>
                      <textarea
                        value={String(edit.draft ?? '')}
                        onChange={(e) => {
                          setEdit((x) => ({ ...x, draft: e.target.value }));
                          setDirty(true);
                        }}
                        rows={8}
                        placeholder="Le texte prêt à coller sur la plateforme, dans la langue du fil."
                        className="w-full rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)]/60 p-2 font-mono text-base leading-relaxed text-[var(--fg-3)] placeholder:text-[var(--fg-4)] focus:border-amber-500/50 focus:outline-none sm:text-xs"
                      />
                    </div>
                  </details>
                </>
              ) : (
                <label className="text-[11px] font-medium uppercase tracking-wide text-amber-400/90">
                  Réponse (le fil est en français — ce texte est celui qui part)
                  <textarea
                    value={String(edit.draft ?? '')}
                    onChange={(e) => {
                      setEdit((x) => ({ ...x, draft: e.target.value }));
                      setDirty(true);
                    }}
                    rows={12}
                    placeholder="Le texte prêt à coller sur la plateforme."
                    className="mt-1 w-full rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)]/80 p-3 text-[16px] leading-relaxed text-[var(--fg-2)] placeholder:text-[var(--fg-4)] focus:border-amber-500/50 focus:outline-none sm:text-[15px]"
                  />
                  <span className={`mt-1 block normal-case ${charCounter(String(edit.draft ?? '').length, selected.source, limits).cls}`}>
                    {charCounter(String(edit.draft ?? '').length, selected.source, limits).text}
                  </span>
                </label>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={async () => {
                    const text = String(edit.draft ?? '');
                    const cc = charCounter(text.length, selected.source, limits);
                    const ok = await copyToClipboard(text);
                    if (!ok) {
                      say('Copie refusée par le navigateur.');
                    } else if (cc.over) {
                      say(`⚠ Copié, mais le texte DÉPASSE la limite de ${SOURCE_LABELS[selected.source] ?? selected.source} — raccourcis avant de poster.`);
                    } else {
                      say(`Réponse copiée (version ${LANG_LABELS[String(edit.lang ?? selected.lang)] ?? ''}).`);
                    }
                  }}
                  disabled={!String(edit.draft ?? '').trim()}
                  className="flex-1 rounded bg-amber-500 px-3 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-40 sm:flex-none sm:py-1.5 sm:text-xs"
                >
                  Copier la réponse ({LANG_LABELS[String(edit.lang ?? selected.lang)] ?? '?'})
                </button>
                <button
                  onClick={() => void save()}
                  disabled={busy !== null || !dirty}
                  className="flex-1 rounded border border-emerald-500/40 px-3 py-2.5 text-sm font-medium text-emerald-400 transition-colors hover:bg-emerald-500/10 disabled:opacity-40 sm:flex-none sm:py-1.5 sm:text-xs"
                >
                  {busy === 'save' ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'Enregistré ✓'}
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--fg-4)]">
                  Statut
                  <select
                    value={String(edit.status ?? selected.status)}
                    onChange={(e) => {
                      setEdit((x) => ({ ...x, status: e.target.value }));
                      setDirty(true);
                    }}
                    className="mt-1 w-full rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)]/60 p-2 text-base text-[var(--fg-2)] sm:text-sm"
                  >
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
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
                    placeholder="détectée automatiquement au prochain scan"
                    className="mt-1 w-full rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)]/60 p-2 text-base text-[var(--fg-2)] placeholder:text-[var(--fg-4)] sm:text-sm"
                  />
                  <span className="mt-0.5 block text-[10px] normal-case text-[var(--fg-4)]">
                    Le radar détecte tout seul tes réponses GitHub (et Stack Overflow dès que le compte existe) : rien à
                    cocher. Ce champ n&apos;est qu&apos;un secours.
                  </span>
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
                  className="mt-1 w-full rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)]/60 p-2 text-base text-[var(--fg-2)] placeholder:text-[var(--fg-4)] focus:border-amber-500/50 focus:outline-none sm:text-sm"
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
        </>
      )}

      {/* Marketplace presence — its own pane since 18/08, no longer a footer. */}
      {pane === 'markets' && (
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-sm font-semibold text-white">Marketplaces &amp; annuaires</h2>
          <p className="text-xs text-[var(--fg-4)]">
            où IBANforge est visible, où il manque : vérifié automatiquement par le radar quotidien
          </p>
        </div>

        {/* The state of the shop windows at a glance, before the detail. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              { status: 'listed', hint: 'IBANforge y est visible' },
              { status: 'pending', hint: 'soumission déposée, en attente' },
              { status: 'absent', hint: 'pas encore présent : à conquérir' },
              { status: 'unknown', hint: 'la sonde n’a pas pu conclure' },
            ] as const
          ).map(({ status, hint }) => {
            const badge = PRESENCE_BADGE[status];
            const n = markets.filter((m) => m.status === status).length;
            return (
              <div key={status} className="rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 px-3 py-2.5" title={hint}>
                <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
                  {badge.label}
                </span>
                <div className="mt-1 font-mono text-xl tabular-nums text-[var(--fg-1)]">{n}</div>
              </div>
            );
          })}
        </div>
        {/* Phone layout: stacked cards; the table needs a real screen. */}
        <div className="flex flex-col gap-2 sm:hidden">
          {markets.map((m) => {
            const badge = PRESENCE_BADGE[m.status] ?? PRESENCE_BADGE.unknown;
            return (
              <div key={m.slug} className="rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 p-3">
                <div className="flex items-center gap-2">
                  <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
                    {badge.label}
                  </span>
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--fg-2)] underline decoration-[var(--ink-4)] underline-offset-2"
                  >
                    {m.name}
                  </a>
                  {m.action_url && m.action_url !== m.url && (
                    <a href={m.action_url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[11px] text-amber-400/80">
                      agir ↗
                    </a>
                  )}
                </div>
                {m.detail && <p className="mt-1.5 text-xs text-[var(--fg-3)]">{m.detail}</p>}
                <p className="mt-1 font-mono text-[10px] text-[var(--fg-4)]">
                  vérifié {m.checked_at ? m.checked_at.slice(0, 16).replace('T', ' ') : 'jamais'}
                </p>
              </div>
            );
          })}
          {markets.length === 0 && (
            <div className="rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 p-4 text-center text-sm text-[var(--fg-3)]">
              Liste vide : lance « Vérifier les marketplaces ».
            </div>
          )}
        </div>

        <div className="hidden overflow-x-auto rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 sm:block">
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
                        className="w-full min-w-[140px] rounded border border-transparent bg-transparent p-1 text-base text-[var(--fg-3)] placeholder:text-[var(--fg-4)]/60 focus:border-[var(--ink-4)] focus:bg-[var(--ink-0)]/60 focus:outline-none sm:text-xs"
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
        {marketEvents.length > 0 && (
          <div className="rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 p-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[var(--fg-4)]">
              Derniers changements détectés (aussi notifiés sur Telegram)
            </p>
            <ul className="flex flex-col gap-1.5">
              {marketEvents.map((e) => {
                const name = markets.find((m) => m.slug === e.slug)?.name ?? e.slug;
                return (
                  <li key={e.id} className="text-xs text-[var(--fg-3)]">
                    <span className="font-mono text-[10px] text-[var(--fg-4)]">
                      {e.created_at.slice(0, 16).replace('T', ' ')}
                    </span>{' '}
                    <span className="text-[var(--fg-2)]">{name}</span> : {e.from_status} → {e.to_status}
                    {e.detail ? ` (${e.detail})` : ''}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
