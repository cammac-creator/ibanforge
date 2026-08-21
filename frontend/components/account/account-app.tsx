"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * The customer's own view of their key.
 *
 * The key is read straight from this component into a `fetch` against the API
 * host and nowhere else: no Next route handler, no server action, no cookie.
 * That is a deliberate design choice and not an implementation shortcut —
 * a customer pasting a live credential into a page is entitled to the claim
 * "it does not touch our servers", and the only way to keep that claim true is
 * for the browser to talk to the API directly.
 *
 * The consequence is that this page needs no session and no ADMIN_SECRET, so
 * unlike the dashboard it renders identically in a preview deployment.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.ibanforge.com";

interface ErrorGroup {
  path: string;
  status: number;
  count: number;
  meaning: string;
  fix: string;
}

interface Report {
  window_days: number;
  total: number;
  ok: number;
  failed: number;
  avg_ms: number | null;
  days: Array<{ day: string; count: number; failed: number }>;
  endpoints: Array<{ path: string; count: number }>;
  errors: ErrorGroup[];
  footprint: { distinct_networks: number; unusual: boolean | null };
}

interface Payload {
  key_prefix: string;
  usage: { used: number; limit: number; remaining: number; month: string };
  report: Report;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "unreachable" }
  | { kind: "ready"; data: Payload };

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono text-2xl tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** A bar per day of the window, gaps filled here — the browser owns the calendar. */
function Days({ days, span }: { days: Array<{ day: string; count: number; failed: number }>; span: number }) {
  const known = new Map(days.map((d) => [d.day, d]));
  const cells: Array<{ key: string; count: number; failed: number }> = [];
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const hit = known.get(key);
    cells.push({ key, count: hit?.count ?? 0, failed: hit?.failed ?? 0 });
  }
  const max = Math.max(1, ...cells.map((c) => c.count));
  return (
    <div className="flex h-16 items-end gap-px" aria-hidden>
      {cells.map((c) => (
        <span
          key={c.key}
          title={`${c.key} · ${c.count}`}
          className={`min-w-[2px] flex-1 rounded-sm ${
            c.count === 0 ? "bg-muted" : c.failed > 0 ? "bg-amber-500/70" : "bg-emerald-500/70"
          }`}
          style={{ height: c.count === 0 ? "3px" : `${Math.max(8, (c.count / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function AccountApp() {
  const t = useTranslations("account");
  const [key, setKey] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;
    setState({ kind: "loading" });
    try {
      const res = await fetch(`${API_URL}/v1/keys/report?days=30`, {
        headers: { Authorization: `Bearer ${trimmed}` },
      });
      if (res.status === 401) {
        setState({ kind: "invalid" });
        return;
      }
      if (!res.ok) {
        setState({ kind: "unreachable" });
        return;
      }
      setState({ kind: "ready", data: (await res.json()) as Payload });
    } catch {
      // Network failure, CORS, offline. Never blame the key for this.
      setState({ kind: "unreachable" });
    }
  }

  const d = state.kind === "ready" ? state.data : null;

  return (
    <div className="space-y-8">
      <form onSubmit={submit} className="space-y-3">
        <label htmlFor="apikey" className="block text-sm font-medium">
          {t("keyLabel")}
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="apikey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("keyPlaceholder")}
            className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 font-mono text-sm"
          />
          <button
            type="submit"
            disabled={state.kind === "loading" || !key.trim()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {state.kind === "loading" ? t("loading") : t("submit")}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{t("privacy")}</p>
      </form>

      {state.kind === "idle" && <p className="text-sm text-muted-foreground">{t("noKey")}</p>}
      {state.kind === "invalid" && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">{t("invalid")}</p>
      )}
      {state.kind === "unreachable" && (
        <p className="rounded-md border px-4 py-3 text-sm text-muted-foreground">{t("unreachable")}</p>
      )}

      {d && (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 font-heading text-lg font-semibold">{t("quotaTitle")}</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label={t("used")} value={d.usage.used.toLocaleString()} hint={d.usage.month} />
              <Stat label={t("remaining")} value={Math.max(0, d.usage.remaining).toLocaleString()} />
              <Stat label={t("avgMs")} value={d.report.avg_ms == null ? "—" : `${d.report.avg_ms} ms`} />
            </div>
          </section>

          <section>
            <h2 className="mb-3 font-heading text-lg font-semibold">{t("windowTitle")}</h2>
            <Days days={d.report.days} span={d.report.window_days} />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Stat label={t("served")} value={d.report.ok.toLocaleString()} />
              <Stat label={t("failed")} value={d.report.failed.toLocaleString()} />
            </div>
          </section>

          {d.report.endpoints.length > 0 && (
            <section>
              <h2 className="mb-3 font-heading text-lg font-semibold">{t("endpointsTitle")}</h2>
              <ul className="space-y-1">
                {d.report.endpoints.map((e) => (
                  <li key={e.path} className="flex items-baseline justify-between gap-4 text-sm">
                    <span className="min-w-0 truncate font-mono text-muted-foreground">{e.path}</span>
                    <span className="font-mono tabular-nums">{e.count.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="mb-3 font-heading text-lg font-semibold">{t("errorsTitle")}</h2>
            {d.report.errors.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noErrors")}</p>
            ) : (
              <ul className="space-y-3">
                {d.report.errors.map((e) => (
                  <li key={`${e.path} ${e.status}`} className="rounded-lg border bg-card px-4 py-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
                      <span className="font-mono font-semibold">{e.status}</span>
                      <span className="min-w-0 truncate font-mono text-muted-foreground">{e.path}</span>
                      <span className="ml-auto font-mono tabular-nums">{e.count.toLocaleString()}</span>
                    </div>
                    <p className="mt-1 text-sm">{e.meaning}</p>
                    {e.fix && <p className="mt-0.5 text-sm text-muted-foreground">{e.fix}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-3 font-heading text-lg font-semibold">{t("footprintTitle")}</h2>
            <div
              className={`rounded-lg border px-4 py-3 ${
                d.report.footprint.unusual === true ? "border-amber-500/40 bg-amber-500/10" : "bg-card"
              }`}
            >
              <div className="font-mono text-2xl tabular-nums">
                {d.report.footprint.distinct_networks}{" "}
                <span className="text-sm font-normal text-muted-foreground">{t("networks")}</span>
              </div>
              <p className="mt-1 text-sm">
                {d.report.footprint.unusual == null
                  ? t("footprintUnknown")
                  : d.report.footprint.unusual
                    ? t("footprintUnusual")
                    : t("footprintCalm")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{t("footprintHint")}</p>
            </div>
          </section>

          <p className="text-sm text-muted-foreground">{t("rotateHint")}</p>
        </div>
      )}
    </div>
  );
}
