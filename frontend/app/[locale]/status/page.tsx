import { getTranslations } from "next-intl/server";

export const revalidate = 300;

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "https://api.ibanforge.com";

interface DayStat {
  date: string;
  total_requests: number;
  s5xx: number;
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
      const res = await fetch(`${API_URL}/stats/history?period=90`, {
        headers: { Authorization: `Bearer ${token}` },
        next: { revalidate: 300 },
      });
      if (res.ok) {
        const rows = (await res.json()) as Array<{ date: string; total_requests: number; s5xx: number }>;
        days = rows.map((r) => ({ date: r.date, total_requests: r.total_requests ?? 0, s5xx: r.s5xx ?? 0 }));
      }
    } catch {
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
  return { title: `${t("title")} | IBANforge`, description: t("subtitle") };
}

export default async function StatusPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("status");
  const tag = LOCALE_TAG[locale] ?? "en-US";
  const data = await getStatusData();

  const dayMap = new Map(data.days.map((d) => [d.date, d]));
  const bars: { key: string; label: string; day: DayStat | null }[] = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    bars.push({
      key,
      label: d.toLocaleDateString(tag, { day: "2-digit", month: "short" }),
      day: dayMap.get(key) ?? null,
    });
  }

  const windows: { label: string; value: string | null }[] = [
    { label: t("w7"), value: successRate(data.days, 7) },
    { label: t("w30"), value: successRate(data.days, 30) },
    { label: t("w90"), value: successRate(data.days, 90) },
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

      <div className="mt-10 grid grid-cols-3 gap-px rounded-lg border border-border bg-border overflow-hidden">
        {windows.map((w) => (
          <div key={w.label} className="bg-card p-4">
            <p className="font-heading text-2xl font-semibold tabular-nums">
              {w.value === null ? "—" : `${w.value}%`}
            </p>
            <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">{w.label}</p>
          </div>
        ))}
      </div>

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
