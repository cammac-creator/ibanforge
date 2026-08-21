'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  callsToday,
  chipOfDossier,
  heatOfDossier,
  sortDossiers,
  SORT_DEFAULT_DIR,
  type ClientDossier,
  type SortDir,
  type SortKey,
  type Verdict,
} from '@/lib/crm/client-dossiers';
import { flameOf } from '@/lib/crm/heat';
import { fold } from '@/lib/crm/mail-rows';
import { contactsHref } from '@/lib/crm/deep-link';
import { ClientDossierModal } from './client-dossier-modal';
import { VERDICTS, VERDICT_BY_KEY } from './verdict-meta';
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
          style={{ height: `${Math.max(8, (d.count / max) * 100)}%` }}
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
type Filter = Verdict | 'all' | 'used';

/** Column order mirrors the row layout; every header sorts (ask of 18/08). */
const HEADERS: Array<{ key: SortKey; label: string; width: string; right?: boolean }> = [
  // État lost its 12% and its coloured dot on 21/08: the word already carries
  // the colour, so the dot repeated it and paid for the repetition in width.
  { key: 'state', label: 'État', width: 'md:w-[8%]' },
  // Requêtes now carries two figures — today over the window total — so it
  // takes back the width État gave up.
  { key: 'requests', label: 'Requêtes', width: 'md:w-[13%]', right: true },
  { key: 'last30', label: '30 jours', width: 'md:w-24' },
  { key: 'freshness', label: 'Dernier appel', width: 'md:w-[13%]' },
  { key: 'countries', label: 'Pays contrôlés', width: 'md:min-w-0 md:flex-1' },
  { key: 'mails', label: 'Mails', width: 'md:w-14', right: true },
];

export function ClientsApp({ dossiers, locale, windowDays = 90 }: { dossiers: ClientDossier[]; locale: string; windowDays?: number }) {
  // Freshness first: the operator's default question is "who moved lately?",
  // not "who is biggest?" (explicit ask, 18/08/2026).
  const [sort, setSort] = useState<SortKey>('freshness');
  const [dir, setDir] = useState<SortDir>(SORT_DEFAULT_DIR.freshness);
  const [filter, setFilter] = useState<Filter>('used');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [stateMenuOpen, setStateMenuOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // ⌘K deep link: /clients?open=<email> lands with that dossier open. Filter
  // widens to 'all' so a silent-key customer is not hidden by the default view.
  const searchParams = useSearchParams();
  useEffect(() => {
    const wanted = searchParams.get('open')?.toLowerCase();
    if (!wanted) return;
    const hit = dossiers.find((d) => d.id === wanted || d.email.toLowerCase() === wanted);
    if (hit) {
      setFilter('all');
      setOpenId(hit.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const c = {} as Record<Verdict, number>;
    for (const v of VERDICTS) c[v.key] = 0;
    for (const d of dossiers) c[d.verdict]++;
    return c;
  }, [dossiers]);

  const view = useMemo(() => {
    // Folded on both sides, like the Contacts search: "societe" finds Société.
    const q = fold(query.trim());
    const filtered = dossiers.filter((d) => {
      if (filter === 'used' && d.requests === 0) return false;
      if (filter !== 'all' && filter !== 'used' && d.verdict !== filter) return false;
      if (!q) return true;
      return (
        fold(d.email).includes(q) ||
        fold(d.company ?? '').includes(q) ||
        d.countries.some((c) => c.code.toLowerCase() === q) ||
        d.keys.some((k) => k.prefix.toLowerCase().includes(q))
      );
    });
    return sortDossiers(filtered, sort, dir);
  }, [dossiers, filter, query, sort, dir]);

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

  const totalRequests = dossiers.reduce((s, d) => s + d.requests, 0);
  const distinctCountries = new Set(dossiers.flatMap((d) => d.countries.map((c) => c.code))).size;

  function onHeader(key: SortKey) {
    if (sort === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(key);
      setDir(SORT_DEFAULT_DIR[key]);
    }
  }

  const arrowOf = (key: SortKey) => (sort === key ? (dir === 'asc' ? ' ▲' : ' ▼') : '');
  const filterMeta = filter !== 'all' && filter !== 'used' ? VERDICT_BY_KEY[filter] : null;
  const usedCount = dossiers.filter((d) => d.requests > 0).length;

  const headerBtn = (active: boolean) =>
    `shrink-0 rounded px-1 py-0.5 text-left transition-colors hover:text-[var(--fg-2)] ${
      active ? 'text-[var(--fg-2)]' : ''
    }`;

  const opened = openId ? (view.find((d) => d.id === openId) ?? dossiers.find((d) => d.id === openId) ?? null) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { l: 'Clients', v: String(dossiers.length), h: `${usedCount} ont appelé` },
          { l: 'Requêtes cumulées', v: totalRequests.toLocaleString('fr-CH'), h: `${windowDays} derniers jours` },
          { l: 'Pays contrôlés', v: String(distinctCountries), h: 'tous clients confondus' },
          { l: 'À débloquer', v: String(counts.blocked), h: 'arrêtés sur un refus' },
        ].map((s) => (
          <div key={s.l} className="rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 px-4 py-3">
            <div className="text-[12px] uppercase tracking-wider text-[var(--fg-5)]">{s.l}</div>
            <div className="font-mono text-2xl tabular-nums text-[var(--fg-1)]">{s.v}</div>
            <div className="text-[12px] text-[var(--fg-4)]">{s.h}</div>
          </div>
        ))}
      </div>

      <div className="relative min-w-0 overflow-hidden rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/40">
        {/* Every control lives in the header row itself: click a column to
            sort it (again to flip), click État to filter, click the lens to
            search. On phones the row thumb-scrolls; the old pill bar is gone. */}
        <div className="flex items-center gap-3 overflow-x-auto whitespace-nowrap border-b border-[var(--ink-4)] px-4 py-2 text-[11.5px] uppercase tracking-wider text-[var(--fg-5)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="flex w-auto shrink-0 items-center gap-1 md:w-[27%] md:shrink">
            <button type="button" onClick={() => onHeader('name')} className={headerBtn(sort === 'name')} title="Trier par nom">
              Client{arrowOf('name')}
            </button>
            {searchOpen || query ? (
              <span className="flex items-center gap-1">
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onBlur={() => {
                    if (!query.trim()) setSearchOpen(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setQuery('');
                      setSearchOpen(false);
                    }
                  }}
                  placeholder="Nom, adresse, clé, pays…"
                  className="w-40 rounded border border-[var(--ink-4)] bg-[var(--ink-1)] px-1.5 py-0.5 text-base normal-case tracking-normal text-[var(--fg-1)] placeholder:text-[var(--fg-5)] focus:border-[var(--amber-500)]/50 focus:outline-none sm:text-[12px]"
                />
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setSearchOpen(false);
                  }}
                  aria-label="Effacer la recherche"
                  className="rounded px-1 text-[var(--fg-4)] hover:text-[var(--fg-2)]"
                >
                  ✕
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                aria-label="Rechercher dans les clients"
                title="Rechercher (nom, adresse, clé, pays)"
                className="rounded px-1 text-[12px] text-[var(--fg-5)] hover:text-[var(--fg-2)]"
              >
                🔍
              </button>
            )}
          </span>

          {HEADERS.map((h) =>
            h.key === 'state' ? (
              <button
                key={h.key}
                type="button"
                onClick={() => setStateMenuOpen((o) => !o)}
                title="Filtrer par état (le tri par gravité est dans le menu)"
                className={`flex w-auto shrink-0 items-center gap-1 rounded px-1 py-0.5 text-left transition-colors hover:text-[var(--fg-2)] md:w-[12%] ${
                  sort === 'state' || filterMeta || filter === 'all' ? 'text-[var(--fg-2)]' : ''
                }`}
              >
                {filterMeta && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: filterMeta.colour }} />
                )}
                <span className="truncate">
                  {filterMeta ? `État · ${filterMeta.label}` : filter === 'all' ? 'État · tous' : 'État'}
                  {arrowOf('state')}
                </span>
                <span aria-hidden className="text-[9px]">
                  ▾
                </span>
              </button>
            ) : (
              <button
                key={h.key}
                type="button"
                onClick={() => onHeader(h.key)}
                title="Trier sur cette colonne (re-cliquer inverse)"
                className={`${headerBtn(sort === h.key)} w-auto ${h.width} ${h.right ? 'md:text-right' : ''} ${h.key === 'last30' ? 'md:shrink-0' : ''}`}
              >
                {h.key === 'requests' ? `Requêtes (jour / ${windowDays} j)` : h.label}
                {arrowOf(h.key)}
              </button>
            ),
          )}
        </div>

        {stateMenuOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setStateMenuOpen(false)} aria-hidden />
            <div className="absolute left-3 top-11 z-30 w-72 overflow-hidden rounded-lg border border-[var(--ink-4)] bg-[var(--ink-1)] shadow-2xl md:left-[27%]">
              <button
                type="button"
                onClick={() => {
                  onHeader('state');
                  setStateMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 border-b border-[var(--ink-4)]/60 px-3 py-2 text-left text-[12.5px] text-[var(--fg-3)] hover:bg-[var(--ink-3)]/60"
              >
                ⇅ Trier par gravité {sort === 'state' ? (dir === 'asc' ? '▲' : '▼') : ''}
              </button>
              {(
                [
                  { key: 'used' as Filter, label: 'Ont appelé', n: usedCount, why: 'les adresses qui ont appelé au moins une fois', colour: null },
                  { key: 'all' as Filter, label: 'Tous', n: dossiers.length, why: 'toutes les adresses, clés muettes comprises', colour: null },
                  ...VERDICTS.filter((v) => counts[v.key] > 0).map((v) => ({
                    key: v.key as Filter,
                    label: v.label,
                    n: counts[v.key],
                    why: v.why,
                    colour: v.colour as string | null,
                  })),
                ] as Array<{ key: Filter; label: string; n: number; why: string; colour: string | null }>
              ).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  title={item.why}
                  onClick={() => {
                    setFilter(item.key);
                    setStateMenuOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--ink-3)]/60 ${
                    filter === item.key ? 'bg-[var(--ink-3)]/80 text-white' : 'text-[var(--fg-2)]'
                  }`}
                >
                  {item.colour ? (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: item.colour }} />
                  ) : (
                    <span className="h-1.5 w-1.5 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <span className="font-mono text-[12px] tabular-nums text-[var(--fg-4)]">{item.n}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {view.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[var(--fg-4)]">Aucun client ne correspond.</p>
        ) : (
          view.map((d) => {
            const v = VERDICT_BY_KEY[d.verdict];
            const todayCalls = callsToday(d.days, new Date());
            return (
              <div key={d.id} className="border-b border-[var(--ink-4)]/60 last:border-b-0">
                <button
                  onClick={() => setOpenId(d.id)}
                  aria-haspopup="dialog"
                  className="flex w-full flex-wrap items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--ink-3)]/40 md:flex-nowrap"
                >
                  {/* The address is the identity line, not the subtitle (ask of
                      21/08). Most customers sign up from a free mailbox, so the
                      domain alone said "gmail.com" over and over and told the
                      operator nothing about WHO called. The company name, when
                      we know one, moves underneath as the gloss it always was. */}
                  <span className="w-full min-w-0 md:w-[27%]">
                    <span className="flex items-center gap-1.5">
                    {(() => { const chip = chipOfDossier(d); return chip ? (
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: chip.color, backgroundColor: chip.bg }}>{chip.label}</span>
                    ) : null; })()}
                    <span className="block min-w-0 truncate text-sm font-medium text-[var(--fg-1)]" title={d.email}>
                      {d.email}
                    </span>
                    {(() => { const f = flameOf(heatOfDossier(d, new Date()).score); return f ? (
                      <span className={`shrink-0 text-[11px] ${f.dim ? 'opacity-45' : ''}`}>{f.glyph}</span>
                    ) : null; })()}
                    </span>
                    {d.company && (
                      <span className="block truncate text-[12px] text-[var(--fg-4)]">{d.company}</span>
                    )}
                  </span>
                  <span className="flex w-auto items-center md:w-[8%]">
                    <span className="truncate text-[13px]" style={{ color: v.colour }}>
                      {v.one}
                    </span>
                  </span>
                  {/* Two figures, one column: today, then the window total.
                      "Combien aujourd'hui" and "combien en tout" were the two
                      questions the single number could not answer at once. */}
                  <span className="w-auto text-right font-mono text-sm tabular-nums md:w-[13%]">
                    {todayCalls > 0 ? (
                      <span className="text-[var(--fg-1)]">{todayCalls.toLocaleString('fr-CH')}</span>
                    ) : (
                      <span className="text-[var(--fg-4)]">0</span>
                    )}
                    <span className="text-[var(--fg-4)]"> / </span>
                    <span className="text-[12px] text-[var(--fg-3)]">{d.requests.toLocaleString('fr-CH')}</span>
                  </span>
                  <span className="w-auto shrink-0 md:w-24">
                    <MiniSpark days={d.days} />
                  </span>
                  <span className="w-auto truncate text-[13px] text-[var(--fg-3)] md:w-[13%]">
                    {d.daysSinceLastCall == null && d.usedAllTime > 0
                      ? `rien sur ${windowDays} j · ${d.usedAllTime.toLocaleString('fr-CH')} avant`
                      : relativeDays(d.daysSinceLastCall)}
                  </span>
                  {/* Three flags, then an ellipsis. Five filled the row without
                      being read: past the third the eye stops counting and the
                      column only says "several". The full list stays one click
                      away in the dossier. */}
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--fg-3)]"
                    title={d.countries.length > 3 ? d.countries.map((c) => c.code).join(' ') : undefined}
                  >
                    {d.countries.length === 0
                      ? '—'
                      : d.countries
                          .slice(0, 3)
                          .map((c) => `${flag(c.code)} ${c.code}`)
                          .join('  ') + (d.countries.length > 3 ? ' …' : '')}
                  </span>
                  <span className="w-14 text-right text-[12px]">
                    {d.mails.sent + d.mails.received > 0 ? (
                      <a
                        href={contactsHref(locale, d.id)}
                        onClick={(e) => e.stopPropagation()}
                        title="Ouvrir son fil dans Contacts"
                        className="text-amber-400 hover:underline"
                      >
                        {d.mails.sent + d.mails.received}
                      </a>
                    ) : (
                      <a
                        href={contactsHref(locale, d.id)}
                        onClick={(e) => e.stopPropagation()}
                        title="Écrire dans Contacts"
                        className="text-[var(--fg-4)] hover:text-amber-400"
                      >
                        écrire
                      </a>
                    )}
                    {d.mails.hasDraft && <span className="ml-1 text-[var(--warn)]">•</span>}
                  </span>
                </button>
              </div>
            );
          })
        )}
      </div>

      {opened && (
        <ClientDossierModal d={opened} locale={locale} windowDays={windowDays} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}
