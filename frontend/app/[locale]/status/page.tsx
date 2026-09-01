import { getTranslations } from "next-intl/server";
import { alternatesFor } from "@/lib/seo";

export const revalidate = 300;

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "https://api.ibanforge.com";

/**
 * PERF-07 (audit 2026-09-01): this page asked for ninety days of history every
 * five minutes and waited as long as the API took. At twelve months of
 * retention that query held the API for more than half a second, on a public
 * page nobody had asked to be expensive. Thirty days is what the page actually
 * publishes — the latency tiles were already computed over thirty — so the
 * other sixty days were fetched, parsed and thrown away.
 */
const HISTORY_DAYS = 30;

/**
 * The page is regenerated every five minutes, so a slow API must cost one stale
 * render, never a hanging one. Five seconds is far above the measured cost of
 * the trimmed query and far below any wait a visitor would sit through.
 */
const HISTORY_TIMEOUT_MS = 5_000;

interface DayStat {
  date: string;
  total_requests: number;
  s5xx: number;
  /** Served latency for the day. null when the day had too few served requests. */
  p50_ms: number | null;
  p95_ms: number | null;
  /**
   * The tail, and the figure an integrator running a payout batch is actually
   * exposed to. Its own floor of 100 measured requests, so it goes null on days
   * the p95 still reports — that gap is the honest answer, not a defect.
   */
  p99_ms: number | null;
}

/** One row of /stats/history, before the nulls are normalised into DayStat. */
interface HistoryRow {
  date: string;
  total_requests: number;
  s5xx: number;
  p50_ms?: number | null;
  p95_ms?: number | null;
  p99_ms?: number | null;
}

interface StatusData {
  healthy: boolean;
  latencyMs: number | null;
  version: string | null;
  days: DayStat[];
}

async function getStatusData(): Promise<StatusData> {
  let healthy = false;
  let latencyMs: number | null = null;
  let version: string | null = null;
  let days: DayStat[] = [];

  try {
    const start = Date.now();
    const res = await fetch(`${API_URL}/health`, { next: { revalidate: 300 } });
    latencyMs = Date.now() - start;
    if (res.ok) {
      healthy = true;
      const body = (await res.json()) as { version?: string };
      version = body.version ?? null;
    }
  } catch {
    healthy = false;
  }

  const token = process.env.STATS_TOKEN;
  if (token) {
    try {
      const fetched = fetch(`${API_URL}/stats/history?period=${HISTORY_DAYS}`, {
        headers: { Authorization: `Bearer ${token}` },
        next: { revalidate: 300 },
      }).then(async (res) => (res.ok ? ((await res.json()) as HistoryRow[]) : null));

      /*
       * Race a plain timer rather than abort. An AbortSignal would opt this
       * fetch out of Next's data cache, which is the same trade lib/landing-
       * stats.ts documents; and the point here is to stop waiting on a slow
       * API, not to save it a request already in flight.
       */
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), HISTORY_TIMEOUT_MS));
      const rows = await Promise.race([fetched.catch(() => null), timeout]);
      if (rows) {
        days = rows.map((r) => ({
          date: r.date,
          total_requests: r.total_requests ?? 0,
          s5xx: r.s5xx ?? 0,
          // ?? null, never ?? 0: a missing measurement is not a zero-millisecond
          // response. On a page customers are invited to trust, a fabricated
          // figure is worse than an admitted gap.
          p50_ms: r.p50_ms ?? null,
          p95_ms: r.p95_ms ?? null,
          p99_ms: r.p99_ms ?? null,
        }));
      }
    } catch {
      // Timeout, refusal or unreachable API. An empty history makes every
      // figure on this page render as an em dash, which is the honest answer:
      // a page inviting a prospect to trust the service must not fill a gap
      // with a number nobody measured.
      days = [];
    }
  }

  return { healthy, latencyMs, version, days };
}

function successRate(days: DayStat[], window: number): string | null {
  const slice = days.slice(-window);
  const total = slice.reduce((a, d) => a + d.total_requests, 0);
  if (total === 0) return null;
  const errors = slice.reduce((a, d) => a + d.s5xx, 0);
  return (((total - errors) / total) * 100).toFixed(errors === 0 ? 2 : 3);
}

const LOCALE_TAG: Record<string, string> = { en: "en-US", fr: "fr-CH", de: "de-CH" };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "status" });
  // No "| IBANforge" suffix: the locale layout's title template already
  // appends it, so this used to render "... | IBANforge | IBANforge"
  // (WEB-20, audit 2026-09-01).
  return {
    title: t("title"),
    description: t("subtitle"),
    alternates: alternatesFor(locale, "/status"),
  };
}

export default async function StatusPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("status");
  const tag = LOCALE_TAG[locale] ?? "en-US";
  const data = await getStatusData();

  const dayMap = new Map(data.days.map((d) => [d.date, d]));
  const bars: { key: string; label: string; day: DayStat | null }[] = [];
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    bars.push({
      key,
      label: d.toLocaleDateString(tag, { day: "2-digit", month: "short" }),
      day: dayMap.get(key) ?? null,
    });
  }

  /**
   * The typical day of the window, not the average of the days.
   *
   * A median over the daily percentiles: one bad afternoon should show up as
   * one bad day on the bar chart, not silently raise the headline figure that
   * a prospect reads. Days with no measurement are skipped rather than counted
   * as zero.
   */
  function medianOf(pick: (d: DayStat) => number | null, window: number): number | null {
    const vals = data.days
      .slice(-window)
      .map(pick)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    return vals.length ? vals[Math.floor(vals.length / 2)] : null;
  }
  const p50 = medianOf((d) => d.p50_ms, HISTORY_DAYS);
  const p95 = medianOf((d) => d.p95_ms, HISTORY_DAYS);
  // Published beside the other two because the median is not what an
  // integrator meets: a payout batch makes thousands of calls, and the slowest
  // one in a hundred is the one that sets its timeout budget. Days without
  // enough traffic to have a ninety-ninth percentile contribute nothing here
  // rather than a number borrowed from the p95.
  const p99 = medianOf((d) => d.p99_ms, HISTORY_DAYS);

  /*
   * The ninety-day tile is gone with the ninety-day query (PERF-07). Keeping it
   * would have printed a thirty-day rate under a "90 days" label, which is the
   * one thing this page must never do; leaving it permanently blank would be
   * honest but useless. The `status.w90` message key is now unused.
   */
  const windows: { label: string; value: string | null }[] = [
    { label: t("w7"), value: successRate(data.days, 7) },
    { label: t("w30"), value: successRate(data.days, HISTORY_DAYS) },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-14">
      <div className="flex items-center gap-3">
        <span
          className={`inline-block size-3 rounded-full ${data.healthy ? "bg-emerald-500" : "bg-red-500"}`}
          aria-hidden
        />
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          {data.healthy ? t("operational") : t("disrupted")}
        </h1>
      </div>
      <p className="mt-2 text-muted-foreground">
        {t("subtitle")}
        {data.latencyMs !== null && (
          <span className="font-mono text-sm"> · /health {data.latencyMs} ms</span>
        )}
        {data.version && <span className="font-mono text-sm"> · v{data.version}</span>}
      </p>

      <div className="mt-10 grid grid-cols-2 gap-px rounded-lg border border-border bg-border overflow-hidden">
        {windows.map((w) => (
          <div key={w.label} className="bg-card p-4">
            <p className="font-heading text-2xl font-semibold tabular-nums">
              {w.value === null ? "—" : `${w.value}%`}
            </p>
            <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">{w.label}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-12 font-heading text-lg font-semibold">{t("latencyTitle")}</h2>
      <div className="mt-4 grid grid-cols-3 gap-px rounded-lg border border-border bg-border overflow-hidden">
        {[
          { label: t("latencyP50"), value: p50 },
          { label: t("latencyP95"), value: p95 },
          { label: t("latencyP99"), value: p99 },
        ].map((m) => (
          <div key={m.label} className="bg-card p-4">
            <p className="font-heading text-2xl font-semibold tabular-nums">
              {m.value === null ? (
                <span className="text-base font-normal text-muted-foreground">{t("latencyNoData")}</span>
              ) : (
                `${m.value} ms`
              )}
            </p>
            <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">{m.label}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{t("latencyNote")}</p>

      <h2 className="mt-12 font-heading text-lg font-semibold">{t("last90")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("barsHint")}</p>
      <div className="mt-4 flex items-end gap-[2px] h-10">
        {bars.map(({ key, label, day }) => {
          let color = "bg-muted";
          let title = `${label} — ${t("noData")}`;
          if (day && day.total_requests > 0) {
            color = day.s5xx === 0 ? "bg-emerald-500" : day.s5xx / day.total_requests > 0.01 ? "bg-red-500" : "bg-amber-500";
            title = `${label} — ${day.total_requests.toLocaleString(tag)} req · ${day.s5xx} 5xx`;
          }
          return <div key={key} title={title} className={`flex-1 h-full rounded-[2px] ${color}`} />;
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs font-mono text-muted-foreground">
        <span>{bars[0]?.label}</span>
        <span>{bars[bars.length - 1]?.label}</span>
      </div>

      <p className="mt-10 text-xs text-muted-foreground leading-relaxed max-w-prose">{t("method")}</p>
    </div>
  );
}
