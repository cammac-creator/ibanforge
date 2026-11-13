'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { formatGrouped } from '@/lib/format-grouped';
import styles from './workspace.module.css';
import {
  callsToday,
  chipOfDossier,
  heatOfDossier,
  sortDossiers,
  SORT_DEFAULT_DIR,
  stateOfDossier,
  type ClientDossier,
  type Nuance,
  type SortDir,
  type SortKey,
} from '@/lib/crm/client-dossiers';
import type { BusinessStatus } from '@/lib/crm/types';
import { searchDossiers, type ClientFilter } from '@/lib/crm/client-search';
import { flameOf } from '@/lib/crm/heat';
import { contactsHref, dossierIdFromParam, OPEN_PARAM } from '@/lib/crm/deep-link';
import { ClientDossierModal } from './client-dossier-modal';
import { ConquestChip } from './conquest-chip';
import { NUANCES, NUANCE_BY_KEY, STATES, STATE_BY_KEY } from './verdict-meta';
import { flag, relativeDays } from './dossier-bits';

function MiniSpark({ days }: { days: Array<{ day: string; count: number }> }) {
  if (days.length === 0) return <span className="inline-block h-5 w-20" />;
  const tail = days.slice(-30);
  const max = Math.max(...tail.map((d) => d.count));
  if (max === 0) return <span className="inline-block h-5 w-20" />;
  return (
    <span className="inline-flex h-5 w-20 items-end gap-px" aria-hidden>
      {tail.map((d) => (
        <span
          key={d.day}
          className="min-w-[2px] flex-1 rounded-sm bg-[var(--amber-500)]/60"
          style={{ height: `${d.count === 0 ? 0 : Math.max(8, (d.count / max) * 100)}%` }}
        />
      ))}
    </span>
  );
}

/**
 * Two thirds of the addresses hold a key that has never been called once — free
 * signups that evaporated, and the pilot keys we mint for outreach. They are
 * real and worth being able to see, but opening the page on them buries the
 * dozen customers who actually exist, so the default view is those who called.
 */
type Filter = ClientFilter;

/** The words the API owns, for telling a state filter from a precision one. */
const STATE_KEYS = new Set<string>(STATES.map((s) => s.key));

/** Column order mirrors the row layout; every header sorts (ask of 18/08). */
const HEADERS: Array<{ key: SortKey; label: string; width: string; right?: boolean }> = [
  // État lost its 12% and its coloured dot on 21/08: the word already carries
  // the colour, so the dot repeated it and paid for the repetition in width.
  { key: 'state', label: 'État', width: 'xl:w-[8%]' },
  // Requêtes now carries two figures — today over the window total — so it
  // takes back the width État gave up.
  { key: 'requests', label: 'Requêtes', width: 'xl:w-[13%]', right: true },
  { key: 'last30', label: '30 jours', width: 'xl:w-24' },
  { key: 'freshness', label: 'Dernier appel', width: 'xl:w-[13%]' },
  { key: 'countries', label: 'Pays contrôlés', width: 'xl:min-w-0 xl:flex-1' },
  { key: 'mails', label: 'Mails', width: 'xl:w-14', right: true },
];

export function ClientsApp({
  dossiers,
  locale,
  windowDays = 90,
  readAtIso,
  activityAvailable,
}: {
  dossiers: ClientDossier[];
  locale: string;
  windowDays?: number;
  readAtIso: string;
  activityAvailable: boolean;
}) {
  // ⌘K deep link: /clients?open=<email> lands with that dossier open. Filter
  // widens to 'all' so a silent-key customer is not hidden by the default view.
  //
  // Read on the first render rather than from a mount effect: the page is
  // force-dynamic, so the server and the browser read the same query string
  // and the dossier is open on the first paint instead of one render later —
  // the cascading render react-hooks/set-state-in-effect names (rules turned
  // on 2026-09-07). Only the first render's answer is used, exactly as the
  // mount effect's was.
  const now = useMemo(() => new Date(readAtIso), [readAtIso]);
  const searchParams = useSearchParams();
  // `?open=` names a dossier by its address or by the prefix of one of its
  // keys: the second is what the owner's purchase alert links with.
  const linkedId = useMemo(
    () => dossierIdFromParam(searchParams.get(OPEN_PARAM), dossiers),
    [searchParams, dossiers],
  );

  // Freshness first: the operator's default question is "who moved lately?",
  // not "who is biggest?" (explicit ask, 18/08/2026).
  const [sort, setSort] = useState<SortKey>('freshness');
  const [dir, setDir] = useState<SortDir>(SORT_DEFAULT_DIR.freshness);
  const [filter, setFilter] = useState<Filter>(() => (linkedId ? 'all' : 'used'));
  const [query, setQuery] = useState('');
  const [stateMenuOpen, setStateMenuOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(() => linkedId);
  const closeDossier = useCallback(() => setOpenId(null), []);

  /**
   * The dossiers that are customers. Everything counted on this page is counted
   * here (audit TABS-02 and TABS-08, 2026-09-01): the cards, the État counts,
   * the "ont appelé" line and the table all read one array, so a figure on this
   * page cannot disagree with the table beneath it.
   *
   * `dossiers` itself is kept for exactly one thing: the ⌘K deep link, which
   * must still be able to open a farm's dossier on purpose. Its traffic is said
   * out loud on its own line rather than hidden, because the page's other job
   * is to say what actually hits the API.
   */
  const shown = useMemo(() => dossiers.filter((d) => !d.offBooks), [dossiers]);
  const offBooks = useMemo(() => {
    const rows = dossiers.filter((d) => d.offBooks);
    return { count: rows.length, requests: rows.reduce((s, d) => s + d.requests, 0) };
  }, [dossiers]);

  /**
   * One count per word, states and precisions alike.
   *
   * A DERIVED state is shown on its row but not counted here, and that is the
   * property that makes "Endormis" name the same people on this page as on
   * Contacts: Contacts can only see the addresses the activation table serves,
   * so counting an address it does not know would put this page back to a
   * second figure for one word. The precisions are counted on every row,
   * derived or not, because nothing else computes them.
   */
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of STATES) c[s.key] = 0;
    for (const n of NUANCES) c[n.key] = 0;
    for (const d of shown) {
      const st = stateOfDossier(d);
      if (!st.derived) c[st.status]++;
      if (st.nuance) c[st.nuance]++;
    }
    return c;
  }, [shown]);

  // Searching, filtering and the automatic widening live in lib/crm, tested on
  // their own: see client-search.ts and audit finding TABS-04, 2026-09-01.
  const effectiveFilter = activityAvailable ? filter : 'all';
  const effectiveSort = activityAvailable || sort === 'mails' ? sort : 'name';
  const searched = useMemo(() => searchDossiers(shown, effectiveFilter, query), [shown, effectiveFilter, query]);
  const view = useMemo(() => sortDossiers(searched.rows, effectiveSort, dir), [searched, effectiveSort, dir]);

  // Arrow keys walk the visible list while a dossier is open — the modal
  // stays put, the subject changes. Guarded on an open dossier and on the
  // event not landing in an input, so the search field keeps its cursor keys.
  useEffect(() => {
    if (!openId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const i = view.findIndex((d) => d.id === openId);
      if (i === -1) return;
      const next = view[e.key === 'ArrowDown' ? i + 1 : i - 1];
      if (next) {
        e.preventDefault();
        setOpenId(next.id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId, view]);

  const totalRequests = shown.reduce((s, d) => s + d.requests, 0);
  const distinctCountries = new Set(shown.flatMap((d) => d.countries.map((c) => c.code))).size;

  function onHeader(key: SortKey) {
    if (sort === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(key);
      setDir(SORT_DEFAULT_DIR[key]);
    }
  }

  const arrowOf = (key: SortKey) => (effectiveSort === key ? (dir === 'asc' ? ' ▲' : ' ▼') : '');
  const filterMeta =
    filter === 'all' || filter === 'used'
      ? null
      : STATE_KEYS.has(filter)
        ? STATE_BY_KEY[filter as BusinessStatus]
        : NUANCE_BY_KEY[filter as Nuance];

  const usedCount = shown.filter((d) => d.requests > 0).length;

  const headerBtn = (active: boolean) =>
    `shrink-0 rounded px-1 py-0.5 text-left transition-colors hover:text-[var(--fg-2)] ${
      active ? 'text-[var(--fg-2)]' : ''
    }`;

  const opened = activityAvailable && openId
    ? (view.find((d) => d.id === openId) ?? dossiers.find((d) => d.id === openId) ?? null)
    : null;

  return (
    <div className="space-y-4">
      {!activityAvailable && (
        <div role="status" className="rounded-2xl border border-amber-300/60 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">
          <p className="font-semibold">Activité momentanément indisponible</p>
          <p>Les comptes et leurs conversations restent accessibles. Les volumes, les filtres d’activité et les dossiers détaillés reviendront après une lecture réussie.</p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 xl:grid-cols-4">
        {[
          { l: 'Comptes API', v: formatGrouped(shown.length, locale), h: activityAvailable ? `${usedCount} avec des appels sur la période` : 'identités connues · activité non lue' },
          { l: 'Requêtes sur la période', v: activityAvailable ? formatGrouped(totalRequests, locale) : '—', h: `${windowDays} jours UTC · refus inclus` },
          { l: 'Pays contrôlés', v: activityAvailable ? String(distinctCountries) : '—', h: 'pays des données soumises' },
          { l: 'À débloquer', v: activityAvailable ? String(counts.blocked) : '—', h: 'dernier appel arrêté sur un refus' },
        ].map((s, i) => (
          <div key={s.l} className={`min-w-0 rounded-2xl border px-5 py-5 ${i === 0 ? 'border-emerald-200 bg-emerald-50/80' : 'border-[var(--ink-4)] bg-[var(--ink-1)]'} shadow-[0_2px_12px_rgba(23,35,44,0.025)]`}>
            <div className="text-xs font-semibold text-[var(--fg-3)]">{s.l}</div>
            <div className="my-2 text-3xl font-semibold tracking-tight tabular-nums text-[var(--fg-1)]">{s.v}</div>
            <div className="text-xs leading-relaxed text-[var(--fg-4)]">{s.h}</div>
          </div>
        ))}
      </div>

      {/* The figure the cards stopped counting, kept where it can be read but
          where it cannot be mistaken for business. Silent when there is none:
          a line that always says zero is a line nobody reads. */}
      {activityAvailable && offBooks.count > 0 && (
        <p className="text-[12px] text-[var(--fg-5)]">
          Hors clients : {formatGrouped(offBooks.requests, locale)} requête
          {offBooks.requests > 1 ? 's' : ''} de trafic de fermes et de clés d&apos;amorçage sur{' '}
          {offBooks.count} dossier{offBooks.count > 1 ? 's' : ''}, exclues des cartes ci-dessus
          comme elles le sont de la vue d&apos;ensemble.
        </p>
      )}

      <div className="relative min-w-0 rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/40">
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--ink-4)] p-4">
          <div className={`${styles.searchField} basis-48`}>
            <Search size={18} aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nom, adresse, clé ou pays…"
              aria-label="Rechercher dans les clients"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Effacer la recherche">
                <X size={16} aria-hidden />
              </button>
            )}
          </div>
          <div className="relative w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setStateMenuOpen((o) => !o)}
              disabled={!activityAvailable}
              aria-expanded={stateMenuOpen}
              aria-controls="client-state-filter"
              className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-[var(--ink-4)] px-3 text-sm text-[var(--fg-2)]"
            >
              <SlidersHorizontal size={17} aria-hidden />
              {!activityAvailable ? 'Tous les comptes' : filterMeta?.label ?? (filter === 'all' ? 'Tous les comptes' : 'Appels sur la période')}
            </button>
            {activityAvailable && stateMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setStateMenuOpen(false)}
                  aria-hidden
                />
                <div
                  id="client-state-filter"
                  className="absolute left-0 top-full mt-2 z-30 w-72 max-w-[calc(100vw-4rem)] max-h-[60dvh] overflow-y-auto sm:left-auto sm:right-0 rounded-lg border border-[var(--ink-4)] bg-[var(--ink-1)] shadow-2xl"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onHeader('state');
                      setStateMenuOpen(false);
                    }}
                    className="flex min-h-11 w-full items-center gap-2 border-b border-[var(--ink-4)]/60 px-3 py-2 text-left text-[12.5px] text-[var(--fg-3)] hover:bg-[var(--ink-3)]/60"
                  >
                    ⇅ Trier par gravité {sort === 'state' ? (dir === 'asc' ? '▲' : '▼') : ''}
                  </button>
                  {(
                    [
                      {
                        key: 'used' as Filter,
                        label: 'Appels sur la période',
                        n: usedCount,
                        why: 'les comptes avec au moins une requête sur la période choisie',
                        colour: null,
                      },
                      {
                        key: 'all' as Filter,
                        label: 'Tous',
                        n: shown.length,
                        why: 'toutes les adresses, clés muettes comprises',
                        colour: null,
                      },
                      ...[...STATES, ...NUANCES]
                        .filter((v) => counts[v.key] > 0)
                        .map((v) => ({
                          key: v.key as Filter,
                          label: v.label,
                          n: counts[v.key],
                          why: v.why,
                          colour: v.colour as string | null,
                        })),
                    ] as Array<{
                      key: Filter;
                      label: string;
                      n: number;
                      why: string;
                      colour: string | null;
                    }>
                  ).map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      title={item.why}
                      onClick={() => {
                        setFilter(item.key);
                        setStateMenuOpen(false);
                      }}
                      className={`flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--ink-3)]/60 ${
                        filter === item.key
                          ? 'bg-[var(--ink-3)]/80 text-[var(--fg-1)]'
                          : 'text-[var(--fg-2)]'
                      }`}
                    >
                      {item.colour ? (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: item.colour }}
                        />
                      ) : (
                        <span className="h-1.5 w-1.5 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <span className="font-mono text-[12px] tabular-nums text-[var(--fg-4)]">
                        {item.n}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <p className="px-4 py-2 text-xs text-[var(--fg-4)]" aria-live="polite">
          {view.length} dossier{view.length > 1 ? 's' : ''} affiché{view.length > 1 ? 's' : ''}
        </p>
        <div className="flex items-center gap-2 border-t border-[var(--ink-4)] px-4 py-2 xl:hidden">
          <label htmlFor="client-sort" className="shrink-0 text-xs text-[var(--fg-4)]">Trier par</label>
          <select id="client-sort" value={effectiveSort} onChange={e => { const key = e.target.value as SortKey; setSort(key); setDir(SORT_DEFAULT_DIR[key]); }} className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 text-sm text-[var(--fg-2)]">
            {[{ key: 'name' as SortKey, label: 'Compte' }, ...HEADERS].map(h => <option key={h.key} value={h.key} disabled={!activityAvailable && h.key !== 'name' && h.key !== 'mails'}>{h.label}</option>)}
          </select>
          <button type="button" onClick={() => setDir(d => d === 'asc' ? 'desc' : 'asc')} aria-label="Inverser le sens du tri" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-[var(--ink-4)] text-sm text-[var(--fg-2)]">{dir === 'asc' ? '↑' : '↓'}</button>
        </div>
        <div className="hidden items-center gap-3 border-y xl:flex border-[var(--ink-4)] px-4 py-2 text-[11.5px] text-[var(--fg-4)]">
          <button
            type="button"
            onClick={() => onHeader('name')}
            className={`${headerBtn(sort === 'name')} xl:w-[27%]`}
            title="Trier par nom"
          >
            Compte{arrowOf('name')}
          </button>
          {HEADERS.map((h) => (
            <button
              key={h.key}
              type="button"
              onClick={() => onHeader(h.key)}
              disabled={!activityAvailable && h.key !== 'mails'}
              title="Trier sur cette colonne (re-cliquer inverse)"
              className={`${headerBtn(sort === h.key)} min-h-11 w-auto ${h.width} ${h.right ? 'xl:text-right' : ''} ${h.key === 'last30' ? 'xl:shrink-0' : ''}`}
            >
              {h.key === 'requests' ? <span>Requêtes<span className="block text-[10px]">jour UTC / {windowDays} j</span></span> : h.label}
              {arrowOf(h.key)}
            </button>
          ))}
        </div>

        {/* Announced, never silent: the lens has stepped outside the État
            filter because nothing inside it matched. */}
        {searched.widened && (
          <p className="border-b border-[var(--ink-4)]/60 px-4 py-1.5 text-[12px] text-[var(--fg-4)]">
            Rien sous le filtre actif : la recherche porte sur tous les dossiers.
          </p>
        )}
        {view.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[var(--fg-4)]">
            Aucun compte ne correspond{effectiveFilter !== 'all' ? ', filtre État compris' : ''}.
          </p>
        ) : (
          view.map((d) => {
            const st = stateOfDossier(d);
            const word = STATE_BY_KEY[st.status];
            const nuance = st.nuance ? NUANCE_BY_KEY[st.nuance] : null;
            const todayCalls = callsToday(d.days, now);
            const chip = chipOfDossier(d);
            const flame = activityAvailable ? flameOf(heatOfDossier(d, now).score) : null;
            return (
              <div key={d.id} data-client-row className="flex flex-wrap items-center gap-x-4 gap-y-4 border-b border-[var(--ink-4)]/60 px-4 py-5 last:border-b-0 xl:flex-nowrap">
                <button
                  type="button"
                  onClick={e => { e.currentTarget.focus(); setOpenId(d.id); }}
                  disabled={!activityAvailable}
                  aria-haspopup="dialog"
                  aria-label={`Ouvrir le dossier de ${d.email}`}
                  className="min-h-11 w-full min-w-0 rounded-lg text-left outline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:no-underline xl:w-[27%]"
                >
                  <span className="mb-1 flex flex-wrap items-center gap-1.5">
                    {chip && <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ color: chip.color, backgroundColor: chip.bg }}>{chip.label}</span>}
                    {d.wonByOutreach && <ConquestChip compact />}
                    {flame && <span aria-hidden className={flame.dim ? 'opacity-45' : ''}>{flame.glyph}</span>}
                  </span>
                  <span className="block break-all text-sm font-semibold text-[var(--fg-1)]">{d.email}</span>
                  {d.company && <span className="mt-0.5 block truncate text-xs text-[var(--fg-4)]">{d.company}</span>}
                  {d.profileToValidate && (
                    <span
                      className="mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-500/40"
                      title="Profil de société tiré automatiquement d’un site ou d’un agent utilisateur, pas encore relu par une personne."
                    >
                      profil à valider
                    </span>
                  )}
                  <span className="mt-1 block text-xs text-[var(--fg-4)] xl:hidden">{activityAvailable ? 'Ouvrir les indicateurs →' : 'Activité non lue'}</span>
                </button>
                <div className="flex min-w-0 basis-[calc(50%-0.5rem)] flex-col xl:basis-auto xl:w-[8%]">
                  <span className="mb-1 text-[11px] text-[var(--fg-4)] xl:hidden">État</span>
                  <span className="text-[13px]" style={{ color: activityAvailable ? word.colour : undefined }} title={activityAvailable ? `${word.why}${st.derived ? ' · déduit de la période, sans ligne d’activation' : ''}` : undefined}>
                    {activityAvailable ? `${word.one}${st.derived ? '°' : ''}` : '—'}
                  </span>
                  {activityAvailable && nuance && <span className="text-[11px] text-[var(--fg-4)]" title={nuance.why}>{nuance.one}</span>}
                </div>
                <div className="basis-[calc(50%-0.5rem)] text-sm tabular-nums xl:basis-auto xl:w-[13%] xl:text-right">
                  <span className="mb-1 block text-[11px] text-[var(--fg-4)] xl:hidden">Aujourd’hui UTC / {windowDays} j</span>
                  {activityAvailable ? <><span className="font-semibold text-[var(--fg-1)]">{formatGrouped(todayCalls, locale)}</span><span className="text-[var(--fg-4)]"> / {formatGrouped(d.requests, locale)}</span></> : '—'}
                </div>
                <div className="basis-[calc(50%-0.5rem)] xl:basis-auto xl:w-24 xl:shrink-0">
                  <span className="mb-1 block text-[11px] text-[var(--fg-4)] xl:hidden">30 jours UTC</span>
                  {activityAvailable ? <MiniSpark days={d.days} /> : '—'}
                </div>
                <div className="basis-[calc(50%-0.5rem)] text-[13px] text-[var(--fg-3)] xl:basis-auto xl:w-[13%]">
                  <span className="mb-1 block text-[11px] text-[var(--fg-4)] xl:hidden">Dernier appel · période</span>
                  {!activityAvailable ? '—' : d.daysSinceLastCall == null && d.usedAllTime > 0 ? `aucun sur ${windowDays} j · usage antérieur connu` : relativeDays(d.daysSinceLastCall)}
                </div>
                <div className="min-w-0 flex-1 text-xs text-[var(--fg-3)]" title={activityAvailable ? d.countries.map(c => c.code).join(' ') : undefined}>
                  <span className="mb-1 block text-[11px] text-[var(--fg-4)] xl:hidden">Pays des données</span>
                  {!activityAvailable || !d.countries.length ? '—' : d.countries.slice(0, 3).map(c => `${flag(c.code)} ${c.code}`).join('  ') + (d.countries.length > 3 ? ' …' : '')}
                </div>
                <div className="flex shrink-0 items-center gap-1 text-xs">
                  <span className="tabular-nums text-[var(--fg-4)]" title={`${d.mails.sent} envoyés, ${d.mails.received} reçus`}>{d.mails.sent + d.mails.received || '—'}</span>
                  <a href={contactsHref(locale, d.id)} aria-label={`Ouvrir la conversation de ${d.email}`} className="inline-flex min-h-11 items-center rounded-lg px-2 font-medium text-emerald-800 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-700">Contacts ↗</a>
                  {d.mails.hasDraft && <span className="text-[var(--warn)]" title="Brouillon en attente">•<span className="sr-only">brouillon en attente</span></span>}
                </div>
              </div>
            );
          })
        )}
      </div>

      {opened && (
        <ClientDossierModal
          d={opened}
          locale={locale}
          windowDays={windowDays}
          readAtIso={readAtIso}
          onClose={closeDossier}
        />
      )}
    </div>
  );
}
