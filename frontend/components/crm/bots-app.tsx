'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { sortBots, type BotDossier, type BotSortKey, type BotVerdict } from '@/lib/crm/bot-dossiers';
import { clientsForBot } from '@/lib/crm/agent-bridge';
import { AGENT_PARAM } from '@/lib/crm/deep-link';
import { BotDossierPanel } from './bot-dossier-panel';
import { relativeDays } from './dossier-bits';

// `one` is spelled out rather than derived by trimming the plural's final s:
// that trick turns "Passés au travers" into "Passés au traver".
const VERDICTS: Array<{ key: BotVerdict; label: string; one: string; colour: string; why: string }> = [
  { key: 'servi', label: 'Passés au travers', one: 'Passé au travers', colour: 'var(--warn)', why: 'un appel facturé leur a été servi sans clé API' },
  { key: 'perdu', label: 'Perdus', one: 'Perdu', colour: 'var(--warn)', why: 'plus de la moitié de leurs appels finissent en 404' },
  { key: 'annuaire', label: 'Annuaires', one: 'Annuaire', colour: 'var(--info)', why: 'robot déclaré, servi correctement' },
  { key: 'sonde', label: 'Sondes', one: 'Sonde', colour: 'var(--amber-600)', why: 'refusés en boucle, ils reviennent, ils ne paient pas' },
  { key: 'parti', label: 'Partis', one: 'Parti', colour: 'var(--fg-4)', why: 'plus rien depuis plus de 14 jours' },
  { key: 'visiteur', label: 'Visiteurs', one: 'Visiteur', colour: 'var(--fg-5)', why: 'appel anonyme qui ne se déclare pas' },
];

const VERDICT_BY_KEY = Object.fromEntries(VERDICTS.map((v) => [v.key, v])) as Record<
  BotVerdict,
  (typeof VERDICTS)[number]
>;

const SORTS: Array<{ key: BotSortKey; label: string }> = [
  { key: 'requests', label: 'Requêtes' },
  { key: 'freshness', label: 'Fraîcheur' },
  { key: 'name', label: 'Nom' },
];

function MiniSpark({ days }: { days: Array<{ day: string; count: number }> }) {
  const tail = days.slice(-30);
  const max = Math.max(...tail.map((d) => d.count), 0);
  if (max === 0) return <span className="inline-block h-5 w-20" />;
  return (
    <span className="inline-flex h-5 w-20 items-end gap-px" aria-hidden>
      {tail.map((d) => (
        <span
          key={d.day}
          className="min-w-[2px] flex-1 rounded-sm bg-[var(--info)]/60"
          style={{ height: `${Math.max(8, (d.count / max) * 100)}%` }}
        />
      ))}
    </span>
  );
}

/** What the bridge needs of a customer. Kept minimal so the Clients page can
 *  hand over a projection instead of whole dossiers. */
export interface BridgeClient {
  id: string;
  email: string;
  company?: string | null;
  userAgents: Array<{ ua: string; count: number }>;
}

export function BotsApp({
  bots,
  clients = [],
  locale = 'fr',
}: {
  bots: BotDossier[];
  clients?: BridgeClient[];
  locale?: string;
}) {
  const [sort, setSort] = useState<BotSortKey>('requests');
  const [filter, setFilter] = useState<BotVerdict | 'all'>('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  // Nearly two hundred agents clear the floor. Rendering them all made a page
  // twenty-five thousand pixels tall, where the dozen that matter were
  // indistinguishable from the tail. Nothing is hidden, only folded.
  const [showAll, setShowAll] = useState(false);

  // Deep link from the Clients tab: /clients-bot?ua=<agent> lands with that
  // dossier open. The agent string is the dossier's primary key and is compared
  // verbatim — folding case here would open the wrong row, or none.
  const searchParams = useSearchParams();
  useEffect(() => {
    const wanted = searchParams.get(AGENT_PARAM);
    if (!wanted) return;
    const hit = bots.find((b) => b.id === wanted);
    if (hit) {
      // The agent may sit below the fold or outside the current filter; widen
      // and unfold so the link never lands on a page that looks empty.
      setFilter('all');
      setShowAll(true);
      setOpenId(hit.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Computed once per bot list, not per render of an open panel.
  const crossingsByBot = useMemo(() => {
    const m = new Map<string, ReturnType<typeof clientsForBot>>();
    if (clients.length === 0) return m;
    for (const b of bots) {
      const hits = clientsForBot(b.id, clients);
      if (hits.length > 0) m.set(b.id, hits);
    }
    return m;
  }, [bots, clients]);

  const counts = useMemo(() => {
    const c = {} as Record<BotVerdict, number>;
    for (const v of VERDICTS) c[v.key] = 0;
    for (const b of bots) c[b.verdict]++;
    return c;
  }, [bots]);

  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = bots.filter((b) => {
      if (filter !== 'all' && b.verdict !== filter) return false;
      if (!q) return true;
      return (
        b.userAgent.toLowerCase().includes(q) ||
        (b.homepage ?? '').toLowerCase().includes(q) ||
        b.endpoints.some((e) => e.path.toLowerCase().includes(q))
      );
    });
    return sortBots(filtered, sort);
  }, [bots, filter, query, sort]);

  const VISIBLE = 50;
  const shown = showAll ? view : view.slice(0, VISIBLE);
  const totalRequests = bots.reduce((s, b) => s + b.requests, 0);
  const lost404 = bots.filter((b) => b.verdict === 'perdu').reduce((s, b) => s + b.notFound, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          // The lines are grouped now (TABS-05, TABS-14), so this counts CALLERS
          // and no longer user agents. The subtitle says which, or the number
          // and the label would answer two different questions.
          {
            l: 'Appelants distincts',
            v: String(bots.length),
            h: `${bots.reduce((s2, b) => s2 + (b.members?.length ?? 1), 0)} user agents, ≥ 20 appels / 90 j`,
          },
          { l: 'Requêtes anonymes', v: totalRequests.toLocaleString('fr-CH'), h: 'sans aucune clé API' },
          { l: 'Passés au travers', v: String(counts.servi), h: 'appel facturé servi sans clé' },
          { l: 'Appels dans le vide', v: lost404.toLocaleString('fr-CH'), h: '404 servis à des annuaires' },
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
          onClick={() => setFilter('all')}
          className={`rounded-full px-3 py-1 text-[13px] font-medium transition-colors ${
            filter === 'all' ? 'bg-[var(--ink-5)] text-white' : 'text-[var(--fg-4)] hover:text-[var(--fg-2)]'
          }`}
        >
          Tous <span className="tabular-nums">{bots.length}</span>
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
            placeholder="Agent, domaine, chemin…"
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

      <div className="overflow-hidden rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/40">
        <div className="hidden items-center gap-3 border-b border-[var(--ink-4)] px-4 py-2 text-[12px] uppercase tracking-wider text-[var(--fg-5)] md:flex">
          <span className="w-[30%]">Agent</span>
          <span className="w-[12%]">État</span>
          <span className="w-[11%] text-right">Requêtes</span>
          <span className="w-[10%]">30 jours</span>
          <span className="w-[12%]">Dernier passage</span>
          <span className="flex-1">Ce qu&apos;il demande le plus</span>
          <span className="w-14 text-right">404</span>
        </div>

        {shown.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[var(--fg-4)]">Aucun agent ne correspond.</p>
        ) : (
          shown.map((b) => {
            const v = VERDICT_BY_KEY[b.verdict];
            const open = openId === b.id;
            return (
              <div key={b.id} className="border-b border-[var(--ink-4)]/60 last:border-b-0">
                <button
                  onClick={() => setOpenId(open ? null : b.id)}
                  aria-expanded={open}
                  className={`flex w-full flex-wrap items-center gap-3 px-4 py-2.5 text-left transition-colors md:flex-nowrap ${
                    open ? 'bg-[var(--ink-3)]/60' : 'hover:bg-[var(--ink-3)]/40'
                  }`}
                >
                  <span className="w-full min-w-0 md:w-[30%]">
                    <span className="block truncate text-sm font-medium text-[var(--fg-1)]">{b.label}</span>
                    <span className="block truncate font-mono text-[12px] text-[var(--fg-4)]">
                      {b.members
                        ? `${b.members.length} version${b.members.length > 1 ? 's' : ''}`
                        : (b.homepage?.replace(/^https?:\/\//, '') ?? b.clientKind ?? '—')}
                    </span>
                  </span>
                  <span className="flex w-auto items-center gap-1.5 md:w-[12%]">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: v.colour }} />
                    <span className="truncate text-[13px]" style={{ color: v.colour }}>
                      {v.one}
                    </span>
                  </span>
                  <span className="w-auto text-right font-mono text-sm tabular-nums text-[var(--fg-1)] md:w-[11%]">
                    {b.requests.toLocaleString('fr-CH')}
                  </span>
                  <span className="w-auto md:w-[10%]">
                    <MiniSpark days={b.days} />
                  </span>
                  <span className="w-auto text-[13px] text-[var(--fg-3)] md:w-[12%]">
                    {relativeDays(b.daysSinceLastCall)}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--fg-3)]">
                    {b.endpoints[0]?.path ?? '—'}
                  </span>
                  <span
                    className="w-14 text-right font-mono text-[12px] tabular-nums"
                    style={{ color: b.notFound > 0 ? 'var(--warn)' : 'var(--fg-5)' }}
                  >
                    {b.notFound > 0 ? b.notFound.toLocaleString('fr-CH') : '—'}
                  </span>
                </button>
                {open && (
                  <>
                    {/* The detail the grouping folded away, and the only reason
                        folding it is safe: which build is calling is useful,
                        it just has no business being forty lines of the list. */}
                    {b.members && (
                      <ul className="border-t border-[var(--ink-4)]/60 bg-[var(--ink-1)]/40 px-4 py-2">
                        {b.members.map((m) => (
                          <li key={m.id} className="flex items-baseline gap-3 py-0.5 text-[12px]">
                            <span className="min-w-0 flex-1 truncate font-mono text-[var(--fg-3)]" title={m.userAgent}>
                              {m.label}
                            </span>
                            <span className="shrink-0 font-mono tabular-nums text-[var(--fg-4)]">
                              {m.requests.toLocaleString('fr-CH')}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <BotDossierPanel b={b} crossings={crossingsByBot.get(b.id) ?? []} locale={locale} />
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {view.length > shown.length && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/40 py-2.5 text-[13px] font-medium text-[var(--fg-3)] transition-colors hover:bg-[var(--ink-3)]/50 hover:text-[var(--fg-1)]"
        >
          Afficher les {view.length - shown.length} agents suivants
        </button>
      )}
      {showAll && view.length > VISIBLE && (
        <button
          onClick={() => setShowAll(false)}
          className="w-full py-1 text-[13px] text-[var(--fg-5)] transition-colors hover:text-[var(--fg-3)]"
        >
          Replier
        </button>
      )}
    </div>
  );
}
