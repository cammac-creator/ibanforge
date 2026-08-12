'use client';

import { useEffect, useMemo, useState } from 'react';
import { chipOfDossier, heatOfDossier, sortDossiers, type ClientDossier, type SortKey, type Verdict } from '@/lib/crm/client-dossiers';
import { flameOf } from '@/lib/crm/heat';
import { fold } from '@/lib/crm/mail-rows';
import { contactsHref } from '@/lib/crm/deep-link';
import { ClientDossierPanel } from './client-dossier-panel';
import { flag, relativeDays } from './dossier-bits';

/**
 * The verdict vocabulary, in the order it is offered as a filter: what needs
 * doing first, then what is merely true. `blocked` leads because it is the only
 * one that describes a customer we are actively losing.
 */
const VERDICTS: Array<{ key: Verdict; label: string; one: string; colour: string; why: string }> = [
  { key: 'blocked', label: 'Bloqués', one: 'Bloqué', colour: 'var(--err)', why: 'le dernier échange a été un refus, et rien depuis' },
  { key: 'struggling', label: 'En difficulté', one: 'En difficulté', colour: 'var(--warn)', why: 'plus de 30 % de leurs appels sont rejetés' },
  { key: 'rising', label: 'En montée', one: 'En montée', colour: 'var(--ok)', why: 'volume en nette hausse sur 7 jours' },
  { key: 'active', label: 'Actifs', one: 'Actif', colour: 'var(--info)', why: 'appellent régulièrement' },
  { key: 'dormant', label: 'Dormants', one: 'Dormant', colour: 'var(--fg-4)', why: 'plus rien depuis plus de 14 jours' },
  { key: 'former', label: 'Anciens', one: 'Ancien client', colour: 'var(--violet, #a78bfa)', why: 'ont réellement appelé par le passé, plus rien sur la fenêtre affichée' },
  { key: 'silent', label: 'Muets', one: 'Muet', colour: 'var(--fg-5)', why: 'une clé, jamais utilisée' },
];

const VERDICT_BY_KEY = Object.fromEntries(VERDICTS.map((v) => [v.key, v])) as Record<Verdict, (typeof VERDICTS)[number]>;

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'requests', label: 'Requêtes' },
  { key: 'freshness', label: 'Fraîcheur' },
  { key: 'name', label: 'Nom' },
];

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

export function ClientsApp({ dossiers, locale, windowDays = 90 }: { dossiers: ClientDossier[]; locale: string; windowDays?: number }) {
  const [sort, setSort] = useState<SortKey>('requests');
  const [filter, setFilter] = useState<Filter>('used');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

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
    return sortDossiers(filtered, sort);
  }, [dossiers, filter, query, sort]);

  // Arrow keys walk the visible list while a dossier is open — the inspector
  // stays put, the selection moves. Guarded on an open dossier and on the
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

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { l: 'Clients', v: String(dossiers.length), h: `${dossiers.filter((d) => d.requests > 0).length} ont appelé` },
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

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilter('used')}
          title="Les adresses qui ont appelé au moins une fois"
          className={`rounded-full px-3 py-1 text-[13px] font-medium transition-colors ${
            filter === 'used' ? 'bg-[var(--ink-5)] text-white' : 'text-[var(--fg-4)] hover:text-[var(--fg-2)]'
          }`}
        >
          Ont appelé <span className="tabular-nums">{dossiers.filter((d) => d.requests > 0).length}</span>
        </button>
        <button
          onClick={() => setFilter('all')}
          className={`rounded-full px-3 py-1 text-[13px] font-medium transition-colors ${
            filter === 'all' ? 'bg-[var(--ink-5)] text-white' : 'text-[var(--fg-4)] hover:text-[var(--fg-2)]'
          }`}
        >
          Tous <span className="tabular-nums">{dossiers.length}</span>
        </button>
        {VERDICTS.filter((v) => counts[v.key] > 0).map((v) => (
          <button
            key={v.key}
            onClick={() => setFilter(filter === v.key ? 'all' : v.key)}
            title={v.why}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium transition-colors ${
              filter === v.key ? 'bg-[var(--ink-5)] text-white' : 'text-[var(--fg-4)] hover:text-[var(--fg-2)]'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: v.colour }} />
            {v.label} <span className="tabular-nums">{counts[v.key]}</span>
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nom, adresse, clé, pays…"
            className="w-48 rounded-md border border-[var(--ink-4)] bg-[var(--ink-1)] px-2.5 py-1 text-[13px] text-[var(--fg-1)] placeholder:text-[var(--fg-5)] focus:border-[var(--amber-500)]/50 focus:outline-none"
          />
          <span className="flex items-center gap-0.5 rounded-md border border-[var(--ink-4)] p-0.5">
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={`rounded px-2 py-1 text-[12px] font-medium transition-colors ${
                  sort === s.key ? 'bg-[var(--ink-4)] text-white' : 'text-[var(--fg-4)] hover:text-[var(--fg-2)]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </span>
        </span>
      </div>

      <div className="flex items-start gap-4">
      <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/40">
        <div className="hidden items-center gap-3 border-b border-[var(--ink-4)] px-4 py-2 text-[12px] uppercase tracking-wider text-[var(--fg-5)] md:flex">
          <span className="w-[26%]">Client</span>
          <span className="w-[13%]">État</span>
          <span className="w-[12%] text-right">Requêtes ({windowDays} j)</span>
          <span className="w-[10%]">30 jours</span>
          <span className="w-[12%]">Dernier appel</span>
          <span className="flex-1">Pays contrôlés</span>
          <span className="w-14 text-right">Mails</span>
        </div>

        {view.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[var(--fg-4)]">Aucun client ne correspond.</p>
        ) : (
          view.map((d) => {
            const v = VERDICT_BY_KEY[d.verdict];
            const open = openId === d.id;
            return (
              <div key={d.id} className="border-b border-[var(--ink-4)]/60 last:border-b-0">
                <button
                  onClick={() => setOpenId(open ? null : d.id)}
                  aria-expanded={open}
                  className={`flex w-full flex-wrap items-center gap-3 px-4 py-2.5 text-left transition-colors md:flex-nowrap ${
                    open ? 'bg-[var(--ink-3)]/60' : 'hover:bg-[var(--ink-3)]/40'
                  }`}
                >
                  <span className="w-full min-w-0 md:w-[26%]">
                    <span className="flex items-center gap-1.5">
                    {(() => { const chip = chipOfDossier(d); return chip ? (
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: chip.color, backgroundColor: chip.bg }}>{chip.label}</span>
                    ) : null; })()}
                    <span className="block min-w-0 truncate text-sm font-medium text-[var(--fg-1)]">
                      {d.company ?? d.email.split('@')[1]}
                    </span>
                    {(() => { const f = flameOf(heatOfDossier(d, new Date()).score); return f ? (
                      <span className={`shrink-0 text-[11px] ${f.dim ? 'opacity-45' : ''}`}>{f.glyph}</span>
                    ) : null; })()}
                    </span>
                    <span className="block truncate font-mono text-[12px] text-[var(--fg-4)]">{d.email}</span>
                  </span>
                  <span className="flex w-auto items-center gap-1.5 md:w-[13%]">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: v.colour }} />
                    <span className="truncate text-[13px]" style={{ color: v.colour }}>
                      {v.one}
                    </span>
                  </span>
                  <span className="w-auto text-right font-mono text-sm tabular-nums text-[var(--fg-1)] md:w-[12%]">
                    {d.requests.toLocaleString('fr-CH')}
                  </span>
                  <span className="w-auto md:w-[10%]">
                    <MiniSpark days={d.days} />
                  </span>
                  <span className="w-auto text-[13px] text-[var(--fg-3)] md:w-[12%]">
                    {d.daysSinceLastCall == null && d.usedAllTime > 0
                      ? `rien sur ${windowDays} j · ${d.usedAllTime.toLocaleString('fr-CH')} avant`
                      : relativeDays(d.daysSinceLastCall)}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--fg-3)]">
                    {d.countries.length === 0
                      ? '—'
                      : d.countries
                          .slice(0, 5)
                          .map((c) => `${flag(c.code)} ${c.code}`)
                          .join('  ')}
                  </span>
                  <span className="w-14 text-right text-[12px]">
                    {d.mails.sent + d.mails.received > 0 ? (
                      <a
                        href={contactsHref(locale, d.id)}
                        onClick={(e) => e.stopPropagation()}
                        title="Ouvrir son fil dans Contacts"
                        className="text-amber-400 hover:underline"
                      >
                        ✉ {d.mails.sent + d.mails.received}
                      </a>
                    ) : (
                      <a
                        href={contactsHref(locale, d.id)}
                        onClick={(e) => e.stopPropagation()}
                        title="Écrire dans Contacts"
                        className="text-[var(--fg-4)] hover:text-amber-400"
                      >
                        ✉ écrire
                      </a>
                    )}
                    {d.mails.hasDraft && <span className="ml-1 text-[var(--warn)]">•</span>}
                  </span>
                </button>
                {open && (
                  <div className="xl:hidden">
                    <ClientDossierPanel d={d} locale={locale} windowDays={windowDays} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      {/* The inspector rail: the list never jumps, ↑↓ walks it, and comparing
          two customers becomes two keypresses instead of two scrolls. Hidden
          below xl, where the inline accordion above keeps working. */}
      {(() => {
        const opened = openId ? view.find((d) => d.id === openId) : null;
        return opened ? (
          <aside className="hidden w-[440px] shrink-0 xl:block">
            <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/40">
              <div className="flex items-center justify-between border-b border-[var(--ink-4)]/60 px-4 py-2">
                <p className="text-[12px] uppercase tracking-wider text-[var(--fg-4)]">
                  Dossier · <span className="normal-case text-[var(--fg-2)]">{opened.company ?? opened.email}</span>
                </p>
                <span className="flex items-center gap-2">
                  <span className="text-[11px] text-[var(--fg-5)]">↑↓ pour naviguer</span>
                  <button
                    type="button"
                    onClick={() => setOpenId(null)}
                    className="rounded border border-[var(--ink-5)] px-1.5 text-[12px] text-[var(--fg-3)] hover:text-[var(--fg-1)]"
                  >
                    ✕
                  </button>
                </span>
              </div>
              <ClientDossierPanel d={opened} locale={locale} windowDays={windowDays} />
            </div>
          </aside>
        ) : null;
      })()}
      </div>
    </div>
  );
}
