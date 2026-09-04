'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  KEYLESS_KEYS,
  NATURE_KEYS,
  TREND_PERIODS,
  comparePeriods,
  deltaPct,
  fmtInt,
  isWeekend,
  movingAverage,
  shortDay,
  summariseTrend,
  trendEvents,
  type NatureKey,
  type TrafficTrendDay,
  type TrafficTrendResult,
  type TrendPeriod,
} from '@/lib/traffic-trend';
import { InfoDot } from './info-dot';

/**
 * The whole traffic, day by day, on the overview.
 *
 * One bar per day, six exclusive natures stacked so the bar's height IS the
 * day's traffic, and the 404 series drawn ON TOP OF THEM as a line, on the
 * same axis — see the warning below. Around the bars, what the owner asked
 * for when he moved this card here from the bot tab: the same figures against
 * the period before, a seven-day average through the noise, the days that
 * stand out named in plain words, and the split by nature as one animated
 * band. Motion is the card's language, not its decoration: bars rise from
 * the baseline, figures count up, the split unrolls — and all of it stands
 * still for anyone who asked their system for reduced motion.
 *
 * ⚠️ The 404 line is not decoration. `browser` counts what declares a
 * browser user-agent — and a vulnerability scanner declares Chrome. A scanner
 * sweeping for /etc/passwd lands in `browser` and, read alone, looks exactly
 * like a wave of human visitors. The 404s give it away, so they are drawn on
 * the SAME Y axis as the natures: a second, auto-scaled axis would let forty
 * 404s stand as tall as ten thousand visits.
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
 * things (channels-panel.tsx). A Record over NatureKey, not a list of its
 * own: a seventh nature added to the route and to lib/traffic-trend.ts must
 * fail to compile here rather than quietly go undrawn.
 */
const NATURE_META: Record<NatureKey, NatureMeta> = {
  with_key: {
    label: 'Clients',
    color: '#f59e0b',
    gloss: 'appels portant une clé API — nos clients, la seule bande qui paie.',
  },
  agent: {
    label: 'Clients IA',
    color: '#8b5cf6',
    gloss:
      'appels sans clé sur le point d’entrée MCP ou en REST : de vrais assistants, mais aussi les robots qui surveillent la disponibilité.',
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
    label: 'Hors marché',
    color: '#52525b',
    outlined: true,
    gloss:
      'nos sondes et audits, plus les fermes d’inscriptions regroupées — du volume, pas de la demande.',
  },
};

const NATURES = NATURE_KEYS.map((key) => ({ key, ...NATURE_META[key] }));
const NOT_FOUND_COLOR = '#ef4444';
const AVERAGE_COLOR = '#e4e4e7';

/** Y axis ticks: one decimal so two gridlines never share a label. */
const axisTick = (v: number): string =>
  v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(v);

const keylessOf = (d: TrafficTrendDay): number => KEYLESS_KEYS.reduce((sum, k) => sum + d[k], 0);

/* ------------------------------------------------------------------------ */
/* Motion                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Whether to move at all: the user's system setting, as an external store.
 * The server snapshot says « yes » so the HTML matches the first client
 * paint; a reduced-motion browser then re-renders still, before anything
 * has had time to move.
 */
const MOTION_QUERY = '(prefers-reduced-motion: reduce)';
function subscribeMotion(cb: () => void): () => void {
  const mq = window.matchMedia(MOTION_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
function useMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => !window.matchMedia(MOTION_QUERY).matches,
    () => true,
  );
}

/**
 * A figure that counts up to its value — from zero on the first paint, from
 * the previous value on every change. The server renders the final value,
 * so a reader without JavaScript, or a crawler, gets the number and not a
 * zero; the count-up starts after hydration.
 */
function useCountUp(target: number, animate: boolean): number {
  const [shown, setShown] = useState(target);
  const from = useRef(0);
  useEffect(() => {
    if (!animate) return;
    const start = performance.now();
    const origin = from.current;
    const span = target - origin;
    const duration = 900;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(origin + span * eased));
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, animate]);
  // Still, the figure is the figure: no state has to catch up with it.
  return animate ? shown : target;
}

/* ------------------------------------------------------------------------ */
/* Small parts                                                               */
/* ------------------------------------------------------------------------ */

/** A tiny area chart of one series, drawn with strings so both sides agree. */
function Spark({ values, color, id }: { values: number[]; color: string; id: string }) {
  const max = Math.max(1, ...values);
  const n = Math.max(1, values.length - 1);
  const pts = values.map(
    (v, i) => `${((i / n) * 100).toFixed(2)},${(28 - (v / max) * 26).toFixed(2)}`,
  );
  const line = pts.join(' ');
  const area = `0,28 ${line} 100,28`;
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-7 w-full" aria-hidden>
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.45} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#spark-${id})`} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function DeltaChip({ delta, invert = false }: { delta: number | null; invert?: boolean }) {
  if (delta === null) {
    return <span className="text-[11px] text-[var(--fg-5)]">période précédente indisponible</span>;
  }
  // For 404 and paywall, more is worse: `invert` flips the colour, never the sign.
  const good = invert ? delta <= 0 : delta >= 0;
  const cls = delta === 0 ? 'text-[var(--fg-4)]' : good ? 'text-emerald-400' : 'text-red-400';
  const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '■';
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium tabular-nums ${cls}`}>
      {arrow} {delta > 0 ? '+' : ''}
      {delta} %<span className="font-normal text-[var(--fg-5)]"> vs période précédente</span>
    </span>
  );
}

function Tile({
  label,
  value,
  delta,
  hint,
  series,
  color,
  index,
  animate,
  invert,
}: {
  label: string;
  value: number;
  delta: number | null;
  hint: string;
  series: number[];
  color: string;
  index: number;
  animate: boolean;
  invert?: boolean;
}) {
  const shown = useCountUp(value, animate);
  return (
    <div
      className={`min-w-0 rounded-lg border border-[var(--ink-4)]/60 bg-[var(--ink-1)]/50 px-3 pt-2.5 pb-2 ${animate ? 'traffic-rise' : ''}`}
      style={animate ? { animationDelay: `${index * 70}ms` } : undefined}
    >
      <div className="text-[11px] uppercase tracking-wider text-[var(--fg-4)]">{label}</div>
      <div className="mt-0.5 font-mono text-[22px] leading-none tabular-nums text-[var(--fg-1)]">
        {fmtInt(shown)}
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <DeltaChip delta={delta} invert={invert} />
      </div>
      <div className="mt-1 text-[11px] leading-snug text-[var(--fg-4)]">{hint}</div>
      <div className="mt-1.5">
        <Spark values={series} color={color} id={label.replace(/\W+/g, '-')} />
      </div>
    </div>
  );
}

/** A red ring on the 404 line where a day was named an event. */
function EventDot(props: {
  cx?: number;
  cy?: number;
  payload?: TrafficTrendDay;
  dates?: Set<string>;
}) {
  const { cx, cy, payload, dates } = props;
  if (cx === undefined || cy === undefined || !payload || !dates?.has(payload.date)) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={7} fill={NOT_FOUND_COLOR} fillOpacity={0.18} />
      <circle cx={cx} cy={cy} r={3.5} fill="#0b0b0f" stroke={NOT_FOUND_COLOR} strokeWidth={2} />
    </g>
  );
}

/**
 * Recharts hands the tooltip its own props by cloning this element, so they
 * are all optional here: nothing else in the file may assume they arrived.
 */
interface TooltipInjected {
  active?: boolean;
  payload?: Array<{ payload?: TrafficTrendDay & { avg7?: number } }>;
  before?: Map<string, TrafficTrendDay>;
  todayKey?: string;
}

function TrendTooltip({ active, payload, before, todayKey }: TooltipInjected) {
  const d = payload?.[0]?.payload;
  if (active !== true || d === undefined) return null;
  const prev = before?.get(d.date);
  const vsPrev = prev ? deltaPct(d.total, prev.total) : null;
  const crossing = d.not_found + d.paywall + d.server_error > 0;
  return (
    <div className="min-w-[220px] rounded-lg border border-[var(--ink-5)] bg-[var(--ink-1)]/92 px-3 py-2 text-[12px] shadow-[0_10px_30px_rgba(0,0,0,0.55)] backdrop-blur-md">
      <div className="mb-1 flex items-baseline justify-between gap-4">
        <span className="font-medium text-[var(--fg-1)]">
          {shortDay(d.date)}
          {d.date === todayKey ? (
            <span className="ml-1.5 text-[10.5px] text-amber-300">en cours</span>
          ) : null}
          {isWeekend(d.date) ? (
            <span className="ml-1.5 text-[10.5px] text-[var(--fg-5)]">week-end</span>
          ) : null}
        </span>
        <span className="font-mono tabular-nums text-[var(--fg-1)]">{fmtInt(d.total)}</span>
      </div>
      {vsPrev !== null && (
        <div className="mb-1 text-[11px] text-[var(--fg-4)]">
          {vsPrev > 0 ? '+' : ''}
          {vsPrev} % par rapport à la veille
          {typeof d.avg7 === 'number' ? ` · moyenne 7 j : ${fmtInt(d.avg7)}` : ''}
        </div>
      )}
      {NATURES.map((n) =>
        d[n.key] === 0 ? null : (
          <div key={n.key} className="flex items-baseline justify-between gap-4">
            <span className="flex items-center gap-1.5 text-[var(--fg-3)]">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: n.color }} />
              {n.label}
            </span>
            <span className="font-mono tabular-nums text-[var(--fg-2)]">
              {fmtInt(d[n.key])}
              <span className="ml-1.5 text-[var(--fg-5)]">
                {d.total > 0 ? `${Math.round((d[n.key] / d.total) * 100)} %` : ''}
              </span>
            </span>
          </div>
        ),
      )}
      {crossing && (
        <div className="mt-1 border-t border-[var(--ink-4)] pt-1">
          <div className="mb-0.5 text-[10.5px] uppercase tracking-wider text-[var(--fg-5)]">
            déjà comptés ci-dessus
          </div>
          {d.not_found > 0 && (
            <div
              className="flex items-baseline justify-between gap-4"
              style={{ color: NOT_FOUND_COLOR }}
            >
              <span>404 introuvable</span>
              <span className="font-mono tabular-nums">{fmtInt(d.not_found)}</span>
            </div>
          )}
          {d.paywall > 0 && (
            <div className="flex items-baseline justify-between gap-4 text-amber-300">
              <span>402 paywall</span>
              <span className="font-mono tabular-nums">{fmtInt(d.paywall)}</span>
            </div>
          )}
          {d.server_error > 0 && (
            <div className="flex items-baseline justify-between gap-4 text-red-300">
              <span>5xx erreur serveur</span>
              <span className="font-mono tabular-nums">{fmtInt(d.server_error)}</span>
            </div>
          )}
        </div>
      )}
      <div className="mt-1 border-t border-[var(--ink-4)] pt-1 text-[11px] text-[var(--fg-4)]">
        {fmtInt(d.distinct_ips)} IP distincte{d.distinct_ips > 1 ? 's' : ''}
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
      <p className="text-[12px] text-[var(--fg-5)]">
        Les autres blocs de la page ne sont pas concernés.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* The card                                                                  */
/* ------------------------------------------------------------------------ */

export function TrafficTrendCard({
  result,
  nowIso,
}: {
  result: TrafficTrendResult;
  nowIso: string;
}) {
  const [period, setPeriod] = useState<TrendPeriod>(30);
  const [hovered, setHovered] = useState<NatureKey | null>(null);
  const [hidden, setHidden] = useState<Set<NatureKey>>(() => new Set());
  const animate = useMotion();

  // One clock, the page's: slicing the same history against the browser's
  // clock would put a different « today » on each side of hydration.
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const todayKey = nowIso.slice(0, 10);

  const { current: days, previous } = useMemo(
    () => (result.ok ? comparePeriods(result.days, period, now) : { current: [], previous: null }),
    [result, period, now],
  );
  const s = useMemo(() => summariseTrend(days), [days]);
  const sp = useMemo(() => (previous ? summariseTrend(previous) : null), [previous]);
  const avg = useMemo(() => movingAverage(days, 7), [days]);
  const chartData = useMemo(() => days.map((d, i) => ({ ...d, avg7: avg[i] })), [days, avg]);
  const before = useMemo(() => {
    const m = new Map<string, TrafficTrendDay>();
    for (let i = 1; i < days.length; i++) m.set(days[i].date, days[i - 1]);
    return m;
  }, [days]);
  const events = useMemo(() => trendEvents(days, todayKey), [days, todayKey]);
  const eventDates = useMemo(() => new Set(events.map((e) => e.date)), [events]);

  // Weekends as quiet bands, grouped Saturday–Sunday.
  const weekends = useMemo(() => {
    const out: Array<{ from: string; to: string }> = [];
    for (const d of days) {
      if (!isWeekend(d.date)) continue;
      const last = out[out.length - 1];
      if (last && before.get(d.date)?.date === last.to) last.to = d.date;
      else out.push({ from: d.date, to: d.date });
    }
    return out;
  }, [days, before]);

  const lastIdx = days.length - 1;
  const lastIsToday = lastIdx >= 0 && days[lastIdx]?.date === todayKey;
  const notFoundShare = s.total > 0 ? Math.round((s.notFound / s.total) * 100) : 0;
  const paywallShare = s.total > 0 ? Math.round((s.paywall / s.total) * 100) : 0;

  const shares = NATURES.map((n) => ({
    ...n,
    count: s.byNature[n.key],
    share: s.total > 0 ? s.byNature[n.key] / s.total : 0,
    delta: deltaPct(s.byNature[n.key], sp?.byNature[n.key]),
  }));

  const periodIdx = TREND_PERIODS.indexOf(period);
  const dim = (key: NatureKey): number => (hovered && hovered !== key ? 0.18 : 1);
  const toggleHidden = (key: NatureKey) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section className="relative overflow-hidden rounded-xl border border-[var(--ink-4)]/60 bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 p-4 sm:p-5">
      {/* A faint warm glow in the corner: the one flourish, so the card reads
          as the page's centrepiece and not as one more grey box. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full"
        style={{
          background: 'radial-gradient(closest-side, rgba(245,158,11,0.14), rgba(245,158,11,0))',
        }}
      />

      <div className="relative mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="flex items-center gap-2 text-sm font-medium text-[var(--fg-2)]">
          <span className="traffic-live inline-flex items-center gap-2" aria-hidden />
          Le trafic, jour par jour — {period} jours
        </p>
        <InfoDot>
          Toutes les requêtes reçues, réparties en six natures qui ne se recouvrent pas : la hauteur
          d’une barre est le trafic du jour. La ligne pointillée claire est la moyenne des sept
          derniers jours ; les bandes plus claires sont les week-ends.
          <br />
          <br />
          <strong className="text-[var(--fg-2)]">La ligne rouge, ce sont les 404</strong>,
          superposée aux barres et sur la même échelle. Quand elle monte en même temps que le vert,
          ce n’est pas une vague de visiteurs, c’est un balayage. Les jours cerclés sont ceux que la
          carte nomme plus bas.
          <br />
          <br />
          Chaque chiffre est comparé à la période de même longueur juste avant. 404, 402 et 5xx{' '}
          <strong>traversent</strong> les natures : à ne jamais additionner avec elles.
        </InfoDot>
        <div className="relative ml-auto flex rounded-lg border border-[var(--ink-4)] bg-[var(--ink-1)]/60 p-0.5">
          <span
            aria-hidden
            className="absolute bottom-0.5 top-0.5 rounded-md bg-[var(--ink-4)]"
            style={{
              width: `calc((100% - 4px) / ${TREND_PERIODS.length})`,
              left: 2,
              transform: `translateX(${periodIdx * 100}%)`,
              transition: animate ? 'transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none',
            }}
          />
          {TREND_PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              className={`relative z-10 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                period === p ? 'text-white' : 'text-[var(--fg-4)] hover:text-[var(--fg-2)]'
              }`}
            >
              {p} j
            </button>
          ))}
        </div>
      </div>

      {!result.ok ? (
        <Unavailable result={result} />
      ) : days.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-sm text-[var(--fg-4)]">
          Aucune requête enregistrée sur cette fenêtre.
        </div>
      ) : (
        <>
          <div className="relative mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
            <Tile
              label="Requêtes"
              value={s.total}
              delta={deltaPct(s.total, sp?.total)}
              hint={`sur ${period} jours · ${s.peak ? `pic le ${shortDay(s.peak.date)} (${fmtInt(s.peak.total)})` : '—'}`}
              series={days.map((d) => d.total)}
              color="#e4e4e7"
              index={0}
              animate={animate}
            />
            <Tile
              label="Clients (avec clé)"
              value={s.byNature.with_key}
              delta={deltaPct(s.byNature.with_key, sp?.byNature.with_key)}
              hint={
                s.total > 0
                  ? `${Math.round((s.byNature.with_key / s.total) * 100)} % du trafic — la bande qui paie`
                  : '—'
              }
              series={days.map((d) => d.with_key)}
              color={NATURE_META.with_key.color}
              index={1}
              animate={animate}
            />
            <Tile
              label="Sans clé"
              value={s.keyless}
              delta={deltaPct(s.keyless, sp?.keyless)}
              hint={
                s.total > 0
                  ? `${Math.round((s.keyless / s.total) * 100)} % — hors clients et hors nos tests`
                  : '—'
              }
              series={days.map(keylessOf)}
              color={NATURE_META.anonymous_api.color}
              index={2}
              animate={animate}
            />
            <Tile
              label="404 introuvable"
              value={s.notFound}
              delta={deltaPct(s.notFound, sp?.notFound)}
              hint={
                s.notFound > 0
                  ? `${notFoundShare} % des requêtes${s.notFoundPeak ? ` · pic le ${shortDay(s.notFoundPeak.date)}` : ''}`
                  : 'aucune'
              }
              series={days.map((d) => d.not_found)}
              color={NOT_FOUND_COLOR}
              index={3}
              animate={animate}
              invert
            />
            <Tile
              label="402 paywall"
              value={s.paywall}
              delta={deltaPct(s.paywall, sp?.paywall)}
              hint={s.paywall > 0 ? `${paywallShare} % — la demande qui bute sur le mur` : 'aucune'}
              series={days.map((d) => d.paywall)}
              color="#fbbf24"
              index={4}
              animate={animate}
              invert
            />
          </div>

          {/* min-w-0 so the chart shrinks with the column instead of pushing
              the page sideways on a phone. */}
          <div className="relative h-[240px] min-w-0 sm:h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 12, right: 6, left: 0, bottom: 0 }}
                onMouseLeave={() => setHovered(null)}
              >
                <defs>
                  {NATURES.map((n) => (
                    <linearGradient key={n.key} id={`traffic-${n.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={n.color} stopOpacity={0.98} />
                      <stop offset="100%" stopColor={n.color} stopOpacity={0.55} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                {weekends.map((w) => (
                  <ReferenceArea
                    key={w.from}
                    x1={w.from}
                    x2={w.to}
                    fill="#ffffff"
                    fillOpacity={0.035}
                    stroke="none"
                  />
                ))}
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#71717a', fontSize: 10 }}
                  axisLine={{ stroke: '#27272a' }}
                  tickLine={false}
                  minTickGap={28}
                  tickFormatter={shortDay}
                />
                <YAxis
                  tick={{ fill: '#71717a', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  allowDecimals={false}
                  tickFormatter={axisTick}
                />
                <Tooltip
                  content={<TrendTooltip before={before} todayKey={todayKey} />}
                  cursor={{ fill: '#ffffff', fillOpacity: 0.05 }}
                />
                {NATURES.map((n, i) => (
                  <Bar
                    key={n.key}
                    dataKey={n.key}
                    name={n.label}
                    stackId="nature"
                    hide={hidden.has(n.key)}
                    fill={`url(#traffic-${n.key})`}
                    fillOpacity={n.outlined === true ? 0.35 * dim(n.key) : dim(n.key)}
                    stroke={n.outlined === true ? '#a1a1aa' : undefined}
                    strokeDasharray={n.outlined === true ? '2 2' : undefined}
                    isAnimationActive={animate}
                    animationDuration={900}
                    animationBegin={i * 70}
                    animationEasing="ease-out"
                    onMouseEnter={() => setHovered(n.key)}
                  >
                    {chartData.map((d, j) => (
                      <Cell
                        key={d.date}
                        fillOpacity={lastIsToday && j === lastIdx ? 0.32 * dim(n.key) : undefined}
                      />
                    ))}
                  </Bar>
                ))}
                <Line
                  dataKey="avg7"
                  name="moyenne 7 j"
                  type="monotone"
                  stroke={AVERAGE_COLOR}
                  strokeOpacity={0.55}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                  isAnimationActive={animate}
                  animationDuration={1100}
                  animationBegin={200}
                />
                <Line
                  dataKey="not_found"
                  name="404"
                  // Linear, never monotone: a smoothed curve rounds off the
                  // one-day spike that is exactly the scanner's signature.
                  type="linear"
                  stroke={NOT_FOUND_COLOR}
                  strokeWidth={2}
                  dot={<EventDot dates={eventDates} />}
                  activeDot={{ r: 4, stroke: NOT_FOUND_COLOR, fill: '#0b0b0f' }}
                  isAnimationActive={animate}
                  animationDuration={1000}
                  animationBegin={350}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* The split by nature: one band, then the legend that drives the
              chart — hover dims the others, a click hides a band. */}
          <div className="relative mt-4">
            <div className="mb-2 flex items-baseline gap-2">
              <span className="text-[11px] uppercase tracking-wider text-[var(--fg-4)]">
                Répartition
              </span>
              <span className="text-[11px] text-[var(--fg-5)]">
                survole une nature pour l’isoler, clique pour la masquer
              </span>
            </div>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--ink-4)]/50">
              {shares.map((n) => (
                <span
                  key={`${n.key}-${period}`}

                  // Re-keyed on the period so the band unrolls again on each change;

                  // the growth is a CSS keyframe from zero to the inline width, which

                  // needs no state and no effect.

                  className={animate ? 'traffic-grow' : undefined}

                  title={`${n.label} : ${fmtInt(n.count)} (${Math.round(n.share * 100)} %)`}

                  style={{
                    width: `${n.share * 100}%`,

                    backgroundColor: n.color,

                    opacity: hidden.has(n.key)
                      ? 0.25
                      : hovered && hovered !== n.key
                        ? 0.3
                        : n.outlined
                          ? 0.5
                          : 1,

                    transition: animate ? 'opacity 200ms' : 'none',
                  }}
                />
              ))}
            </div>
            <ul className="mt-2.5 grid gap-x-5 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
              {shares.map((n) => (
                <li key={n.key}>
                  <button
                    type="button"
                    onMouseEnter={() => setHovered(n.key)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => toggleHidden(n.key)}
                    aria-pressed={!hidden.has(n.key)}
                    className={`flex w-full items-start gap-2 rounded-md px-1 py-0.5 text-left text-[12px] leading-snug transition-colors hover:bg-[var(--ink-3)]/60 ${
                      hidden.has(n.key) ? 'opacity-45' : ''
                    }`}
                  >
                    <span
                      className="mt-[3px] h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={
                        n.outlined === true
                          ? { backgroundColor: `${n.color}59`, border: '1px dashed #a1a1aa' }
                          : { backgroundColor: n.color }
                      }
                    />
                    <span className="min-w-0">
                      <span className="font-medium text-[var(--fg-2)]">{n.label}</span>
                      <span className="ml-1.5 font-mono text-[11.5px] tabular-nums text-[var(--fg-3)]">
                        {fmtInt(n.count)} · {Math.round(n.share * 100)} %
                      </span>
                      {n.delta !== null && (
                        <span
                          className={`ml-1.5 text-[11px] tabular-nums ${
                            n.delta > 0
                              ? 'text-emerald-400'
                              : n.delta < 0
                                ? 'text-red-400'
                                : 'text-[var(--fg-5)]'
                          }`}
                        >
                          {n.delta > 0 ? '▲ +' : n.delta < 0 ? '▼ ' : '■ '}
                          {n.delta} %
                        </span>
                      )}
                      <span className="block text-[var(--fg-4)]">{n.gloss}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* The days that stand out, in words. */}
          <div className="relative mt-4 border-t border-[var(--ink-4)]/60 pt-3">
            <div className="mb-1.5 text-[11px] uppercase tracking-wider text-[var(--fg-4)]">
              Ce qui sort de l’ordinaire
            </div>
            {events.length === 0 ? (
              <p className="text-[12.5px] text-[var(--fg-3)]">
                Rien d’anormal sur {period} jours : aucun jour au-delà du double de la médiane,
                aucun balayage de 404.
              </p>
            ) : (
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {events.slice(0, 6).map((e) => (
                  <li key={e.date} className="flex items-start gap-2 text-[12.5px] leading-snug">
                    <span
                      className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${
                        e.kind === 'sweep' ? 'bg-red-500' : 'bg-amber-400'
                      }`}
                    />
                    <span className="text-[var(--fg-2)]">
                      <span className="font-mono tabular-nums text-[var(--fg-1)]">
                        {shortDay(e.date)}
                      </span>
                      {e.kind === 'sweep' ? (
                        <>
                          {' '}
                          — <strong>balayage</strong> : {fmtInt(e.notFound)} requêtes 404 sur{' '}
                          {fmtInt(e.total)}
                          {e.factor > 0
                            ? ` (×${String(e.factor).replace('.', ',')} la médiane des 404)`
                            : ''}{' '}
                          — un scanner cherche des fichiers qui n’existent pas ici.
                        </>
                      ) : (
                        <>
                          {' '}
                          — <strong>pic</strong> : {fmtInt(e.total)} requêtes, ×
                          {String(e.factor).replace('.', ',')} la médiane de la période.
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="relative mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] leading-snug text-[var(--fg-4)]">
            <span className="flex items-center gap-1.5">
              <span
                className="h-0.5 w-3 rounded-full"
                style={{ backgroundColor: NOT_FOUND_COLOR }}
              />
              404 (ligne rouge), sur la même échelle que les barres
              {s.total > 0 && notFoundShare > 0 ? ` — ${notFoundShare} % de la fenêtre` : ''}
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="h-0.5 w-3 rounded-full border-t border-dashed"
                style={{ borderColor: AVERAGE_COLOR }}
              />
              moyenne glissante 7 jours
            </span>
            {lastIsToday && (
              <span>
                dernière barre = <strong className="text-[var(--fg-3)]">aujourd’hui</strong>, en
                cours (comptage depuis minuit UTC)
              </span>
            )}
            {previous === null && (
              <span>
                comparaison indisponible : l’historique chargé ne couvre pas la période précédente
              </span>
            )}
          </div>
          {s.mismatchDays > 0 && (
            <p className="relative mt-2 text-[11px] leading-snug text-amber-400">
              {s.mismatchDays} jour{s.mismatchDays > 1 ? 's' : ''} où la somme des six natures ne
              retombe pas sur le total du jour : les barres sous-estiment ce trafic-là.
            </p>
          )}
        </>
      )}
    </section>
  );
}
