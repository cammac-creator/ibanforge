'use client';

import { useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  NATURE_KEYS,
  TREND_PERIODS,
  sliceToPeriod,
  summariseTrend,
  type NatureKey,
  type TrafficTrendDay,
  type TrafficTrendResult,
  type TrendPeriod,
} from '@/lib/traffic-trend';
import { InfoDot } from './info-dot';

/**
 * The whole traffic, day by day, at the head of the bot tab.
 *
 * The tab below answers "who is this robot"; nothing answered "is there more
 * of them than last month", which is the question that actually gets asked.
 * One bar per day, six exclusive natures stacked so the bar's height IS the
 * day's traffic, and the 404 series drawn ON TOP OF THEM as a line.
 *
 * ⚠️ That line is the reason this card exists, and it is not decoration.
 * `browser` counts what declares a browser user-agent — and a vulnerability
 * scanner declares Chrome. Measured here, a scanner sweeping for /etc/passwd,
 * /WEB-INF/web.xml and /package.json lands in `browser` and, read alone, its
 * sweep looks exactly like a wave of human visitors. The 404s are what give it
 * away, so they are drawn against the SAME Y axis as the natures: a second,
 * auto-scaled axis would let forty 404s stand as tall as ten thousand visits
 * and would recreate the very lie this card is here to kill.
 *
 * Not a use of <StackedBarChart>: that one draws four status classes with a
 * weekday band and an English axis. Fitting the crossing line, the outlined
 * internal band, the French tooltip and the definition legend into it meant
 * four optional props with exactly one caller each — and its single existing
 * caller would carry the risk of every one of them. Only the partial-day rule
 * is deliberately copied over, because it matters more here than there.
 */

interface NatureMeta {
  label: string;
  color: string;
  /** One line, in French, for someone who has never read `client_kind`. */
  gloss: string;
  /** Drawn with a dashed outline instead of a solid fill (see `internal`). */
  outlined?: boolean;
}

/**
 * Colours are the ones the Canaux d'accès panel already uses for the same
 * things (channels-panel.tsx): the two pages must not paint MCP violet here
 * and green there. `agent` merges the two MCP transports, which the gloss says
 * out loud, because their split lives on that other panel and not on this one.
 *
 * A Record over NatureKey, not a list of its own: a seventh nature added to
 * the route and to lib/traffic-trend.ts must fail to compile here rather than
 * quietly go undrawn, which would leave every bar shorter than the traffic it
 * claims to be — the one lie this card cannot afford.
 */
const NATURE_META: Record<NatureKey, NatureMeta> = {
  with_key: {
    label: 'Clients',
    color: '#f59e0b',
    gloss: 'appels portant une clé API — nos clients, la seule bande qui paie.',
  },
  agent: {
    label: 'Agents IA (MCP)',
    color: '#8b5cf6',
    gloss: 'un assistant nous appelle via MCP, hébergé ou en npm, sans clé.',
  },
  declared_bot: {
    label: 'Robots déclarés',
    color: '#71717a',
    gloss: 'crawlers et annuaires qui disent leur nom dans leur user-agent.',
  },
  browser: {
    label: 'Navigateurs',
    color: '#22c55e',
    gloss: 'ce qui se présente comme un navigateur — visiteurs, mais aussi scanners déguisés.',
  },
  anonymous_api: {
    label: 'API anonyme',
    color: '#3b82f6',
    gloss: 'appels REST bruts sans clé : essais, scripts, sondes x402.',
  },
  internal: {
    label: 'Nos tests',
    color: '#52525b',
    outlined: true,
    gloss: 'notre propre cohorte de test — du volume, pas de la demande.',
  },
};

/** Stacking order comes from the lib, which documents it: customers at the
 *  bottom, our own test traffic at the top. */
const NATURES = NATURE_KEYS.map((key) => ({ key, ...NATURE_META[key] }));

const NOT_FOUND_COLOR = '#ef4444';

const fmt = (n: number): string => n.toLocaleString('fr-CH');

/** The day the browser is on, in UTC — the grain the route counts in. */
const todayUtc = (): string => new Date().toISOString().slice(0, 10);

const dayLabel = (date: string): string =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('fr-CH', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  });

/**
 * Recharts hands the tooltip its own props by cloning this element, so they
 * are all optional here: nothing else in the file may assume they arrived.
 */
interface TooltipInjected {
  active?: boolean;
  payload?: Array<{ payload?: TrafficTrendDay }>;
}

function TrendTooltip({ active, payload }: TooltipInjected) {
  const d = payload?.[0]?.payload;
  if (active !== true || d === undefined) return null;
  const crossing = d.not_found + d.paywall + d.server_error > 0;
  return (
    <div className="rounded-lg border border-[var(--ink-5)] bg-[var(--ink-1)]/95 px-3 py-2 text-[12px] shadow-lg">
      <div className="mb-1 flex items-baseline justify-between gap-4">
        <span className="font-medium text-[var(--fg-1)]">{dayLabel(d.date)}</span>
        <span className="font-mono tabular-nums text-[var(--fg-1)]">{fmt(d.total)}</span>
      </div>
      {NATURES.map((n) =>
        d[n.key] === 0 ? null : (
          <div key={n.key} className="flex items-baseline justify-between gap-4">
            <span className="flex items-center gap-1.5 text-[var(--fg-3)]">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: n.color }} />
              {n.label}
            </span>
            <span className="font-mono tabular-nums text-[var(--fg-2)]">{fmt(d[n.key])}</span>
          </div>
        ),
      )}
      {crossing && (
        <div className="mt-1 border-t border-[var(--ink-4)] pt-1">
          {/* Spelled out on every hover: these are already inside the bands
              above. A reader who adds them to the natures doubles the day. */}
          <div className="mb-0.5 text-[10.5px] uppercase tracking-wider text-[var(--fg-5)]">
            déjà comptés ci-dessus
          </div>
          {d.not_found > 0 && (
            <div className="flex items-baseline justify-between gap-4">
              <span style={{ color: NOT_FOUND_COLOR }}>404 introuvable</span>
              <span className="font-mono tabular-nums" style={{ color: NOT_FOUND_COLOR }}>
                {fmt(d.not_found)}
              </span>
            </div>
          )}
          {d.paywall > 0 && (
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-amber-300">402 paywall</span>
              <span className="font-mono tabular-nums text-amber-300">{fmt(d.paywall)}</span>
            </div>
          )}
          {d.server_error > 0 && (
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-red-300">5xx erreur serveur</span>
              <span className="font-mono tabular-nums text-red-300">{fmt(d.server_error)}</span>
            </div>
          )}
        </div>
      )}
      <div className="mt-1 border-t border-[var(--ink-4)] pt-1 text-[11px] text-[var(--fg-4)]">
        {fmt(d.distinct_ips)} IP distincte{d.distinct_ips > 1 ? 's' : ''}
        {/* One IP behind a thousand 404s is a scanner; a thousand IPs behind
            them is a dead link someone published. Same bar, opposite fix. */}
      </div>
    </div>
  );
}

function Unavailable({ result }: { result: Extract<TrafficTrendResult, { ok: false }> }) {
  const message =
    result.reason === 'no-token'
      ? 'STATS_TOKEN non configuré — la tendance globale est indisponible.'
      : result.reason === 'unreachable'
        ? 'API injoignable — la tendance globale n’a pas pu être chargée.'
        : result.reason === 'malformed'
          ? 'Réponse inattendue de /stats/traffic-trend — rien n’a été dessiné plutôt qu’un graphe faux.'
          : `L’API a répondu ${result.status} sur /stats/traffic-trend.`;
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-1 px-4 text-center">
      <p className="text-sm text-[var(--fg-3)]">{message}</p>
      {/* The dossiers below come from another endpoint and another secret, so
          they are very probably still there: say it, or this panel reads as a
          dead page. */}
      <p className="text-[12px] text-[var(--fg-5)]">Les dossiers par robot, plus bas, ne sont pas concernés.</p>
    </div>
  );
}

export function TrafficTrendCard({ result }: { result: TrafficTrendResult }) {
  const [period, setPeriod] = useState<TrendPeriod>(30);

  const days = useMemo(
    () => (result.ok ? sliceToPeriod(result.days, period) : []),
    [result, period],
  );
  const s = useMemo(() => summariseTrend(days), [days]);

  // The last bar is today, still filling up. Left visible but faded: hiding it
  // loses the day being asked about, and drawing it solid makes every morning
  // look like a collapse.
  const lastIdx = days.length - 1;
  const lastIsToday = lastIdx >= 0 && days[lastIdx]?.date === todayUtc();

  const notFoundShare = s.total > 0 ? Math.round((s.notFound / s.total) * 100) : 0;

  return (
    <section className="rounded-xl border border-[var(--ink-4)]/60 bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-2">
        <p className="text-sm font-medium text-[var(--fg-2)]">Évolution du trafic — {period} jours</p>
        <InfoDot>
          Toutes les requêtes reçues, réparties en six natures qui ne se recouvrent pas : la hauteur d’une barre
          est le trafic du jour.
          <br />
          <br />
          <strong className="text-[var(--fg-2)]">La ligne rouge, ce sont les 404</strong>, superposée aux barres
          et sur la même échelle. Elle est là parce que la bande « Navigateurs » ment quand on la lit seule : un
          scanner de vulnérabilités annonce un user-agent Chrome et atterrit dedans. Quand la ligne rouge monte en
          même temps que le vert, ce n’est pas une vague de visiteurs, c’est un balayage — il cherche des fichiers
          qui n’existent pas ici.
          <br />
          <br />
          404, 402 et 5xx <strong>traversent</strong> les natures (une 404 a déjà été comptée dans sa bande) : à ne
          jamais additionner avec elles.
        </InfoDot>
        <span className="ml-auto flex items-center gap-0.5 rounded-md border border-[var(--ink-4)] p-0.5">
          {TREND_PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              className={`rounded px-2 py-1 text-[12px] font-medium transition-colors ${
                period === p ? 'bg-[var(--ink-4)] text-white' : 'text-[var(--fg-4)] hover:text-[var(--fg-2)]'
              }`}
            >
              {p} j
            </button>
          ))}
        </span>
      </div>

      {!result.ok ? (
        <Unavailable result={result} />
      ) : days.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-sm text-[var(--fg-4)]">
          Aucune requête enregistrée sur cette fenêtre.
        </div>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { l: 'Requêtes', v: fmt(s.total), h: `sur ${period} jours` },
              {
                l: 'Sans clé',
                v: fmt(s.keyless),
                // Naming both exclusions: our own test cohort DOES carry a key,
                // so a reader counting the four keyless bands against this
                // percentage would otherwise find it short and mistrust it.
                h:
                  s.total > 0
                    ? `${Math.round((s.keyless / s.total) * 100)} % du trafic — hors clients et hors nos tests`
                    : '—',
              },
              {
                l: '404',
                v: fmt(s.notFound),
                h: s.notFoundPeak ? `pic le ${dayLabel(s.notFoundPeak.date)}` : 'aucune',
              },
              {
                l: 'Jour le plus chargé',
                v: s.peak ? dayLabel(s.peak.date) : '—',
                h: s.peak ? `${fmt(s.peak.total)} requêtes` : '—',
              },
            ].map((t) => (
              <div key={t.l} className="rounded-lg border border-[var(--ink-4)]/60 bg-[var(--ink-1)]/40 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wider text-[var(--fg-5)]">{t.l}</div>
                <div className="font-mono text-lg tabular-nums text-[var(--fg-1)]">{t.v}</div>
                <div className="text-[11px] text-[var(--fg-4)]">{t.h}</div>
              </div>
            ))}
          </div>

          {/* min-w-0 so the chart shrinks with the column instead of pushing
              the page sideways on a phone. */}
          <div className="min-w-0">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={days} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#71717a', fontSize: 10 }}
                  axisLine={{ stroke: '#27272a' }}
                  tickLine={false}
                  // 90 days on a 375px screen is one tick every 4 pixels: let
                  // recharts drop labels until they stop overlapping, rather
                  // than shipping the smear this repo has produced before.
                  minTickGap={28}
                  tickFormatter={dayLabel}
                />
                <YAxis
                  tick={{ fill: '#71717a', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  allowDecimals={false}
                  // Same axis for the bars and the 404 line. No second axis:
                  // see the warning at the top of this file.
                  tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                />
                <Tooltip content={<TrendTooltip />} cursor={{ fill: '#27272a66' }} />
                {NATURES.map((n) => (
                  <Bar
                    key={n.key}
                    dataKey={n.key}
                    name={n.label}
                    stackId="nature"
                    fill={n.color}
                    // `internal` is our own traffic, not demand: outlined
                    // instead of filled, so the eye reads it as an annex of
                    // the bar rather than as one more kind of visitor.
                    fillOpacity={n.outlined === true ? 0.35 : 1}
                    stroke={n.outlined === true ? '#a1a1aa' : undefined}
                    strokeDasharray={n.outlined === true ? '2 2' : undefined}
                    isAnimationActive={false}
                  >
                    {days.map((d, i) => (
                      <Cell key={d.date} fillOpacity={lastIsToday && i === lastIdx ? 0.3 : undefined} />
                    ))}
                  </Bar>
                ))}
                <Line
                  dataKey="not_found"
                  name="404"
                  // Linear, never monotone: a smoothed curve rounds off the
                  // one-day spike that is exactly the scanner's signature.
                  type="linear"
                  stroke={NOT_FOUND_COLOR}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <ul className="mt-3 grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
            {NATURES.map((n) => (
              <li key={n.key} className="flex items-start gap-2 text-[12px] leading-snug">
                <span
                  className="mt-[3px] h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={
                    n.outlined === true
                      ? { backgroundColor: `${n.color}59`, border: `1px dashed #a1a1aa` }
                      : { backgroundColor: n.color }
                  }
                />
                <span className="min-w-0">
                  <span className="font-medium text-[var(--fg-2)]">{n.label}</span>
                  <span className="text-[var(--fg-4)]"> — {n.gloss}</span>
                </span>
              </li>
            ))}
            <li className="flex items-start gap-2 text-[12px] leading-snug sm:col-span-2">
              <span
                className="mt-[6px] h-0.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: NOT_FOUND_COLOR }}
              />
              <span className="min-w-0">
                <span className="font-medium text-[var(--fg-2)]">404 (ligne rouge)</span>
                <span className="text-[var(--fg-4)]">
                  {' '}
                  — requêtes vers une adresse qui n’existe pas. Elle <strong>traverse</strong> les six natures au
                  lieu de s’y ajouter : quand elle monte avec les navigateurs, ce sont des scanners, pas des
                  visiteurs
                  {s.total > 0 && notFoundShare > 0 ? ` (${notFoundShare} % de la fenêtre)` : ''}.
                </span>
              </span>
            </li>
          </ul>

          {lastIsToday && (
            <p className="mt-2 text-[11px] leading-snug text-[var(--fg-4)]">
              La dernière barre = <strong className="text-[var(--fg-3)]">aujourd’hui</strong>, jour en cours
              (comptage depuis minuit UTC). Elle se remplit au fil de la journée — ce n’est pas une chute de
              trafic.
            </p>
          )}
          {s.mismatchDays > 0 && (
            <p className="mt-2 text-[11px] leading-snug text-amber-400">
              {/* Never silently rescale a bar to hide this: a nature the route
                  stopped filling would otherwise vanish without a word. */}
              {s.mismatchDays} jour{s.mismatchDays > 1 ? 's' : ''} où la somme des six natures ne retombe pas sur
              le total du jour : les barres sous-estiment ce trafic-là.
            </p>
          )}
        </>
      )}
    </section>
  );
}
