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

/**
 * A bar per day of the window, gaps filled here.
 *
 * ⚠️ The axis is built in UTC, deliberately. The server groups on
 * `date(created_at)`, which SQLite evaluates in UTC, so a browser walking back
 * through LOCAL days produces keys that miss. For a reader in Zurich the
 * mismatch is invisible most of the day and then eats a bar: a call made at
 * 00:30 local is 22:30 UTC on the previous day, so the server files it under
 * yesterday while a local axis looks for it under today.
 *
 * Matching the server's calendar is the only way the two agree. The day labels
 * are UTC too, which is what an API caller reading their own traffic expects.
 */
function Days({ days, span }: { days: Array<{ day: string; count: number; failed: number }>; span: number }) {
  const known = new Map(days.map((d) => [d.day, d]));
  const cells: Array<{ key: string; count: number; failed: number }> = [];
  const todayUtc = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  for (let i = span - 1; i >= 0; i--) {
    const key = new Date(todayUtc - i * 86_400_000).toISOString().slice(0, 10);
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

/**
 * The rotation panel.
 *
 * It exists because of what the footprint section says right above it. Telling
 * a customer "more networks than a single deployment usually shows" and then
 * offering them nothing to do about it is worse than saying nothing: it raises
 * an alarm and hands over no lever. `/v1/keys/rotate` has been available all
 * along, authenticated by the key itself, and it was reachable only by curl.
 *
 * Guarded behind an explicit confirmation because it is destructive and
 * immediate: the old key stops working the instant the new one is minted.
 */
function Rotate({ apiKey, alarmed }: { apiKey: string; alarmed: boolean }) {
  const t = useTranslations("account");
  const [phase, setPhase] = useState<"idle" | "confirm" | "working" | "done" | "failed">("idle");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function rotate() {
    setPhase("working");
    try {
      const res = await fetch(`${API_URL}/v1/keys/rotate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        setPhase("failed");
        return;
      }
      const body = (await res.json()) as { api_key?: string };
      if (!body.api_key) {
        // A 200 with no key is not a success. Never report one.
        setPhase("failed");
        return;
      }
      setFresh(body.api_key);
      setPhase("done");
    } catch {
      setPhase("failed");
    }
  }

  if (phase === "done" && fresh) {
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3">
        <p className="text-sm font-medium">{t("rotateDone")}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded bg-background px-3 py-2 font-mono text-sm">{fresh}</code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(fresh).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
            className="rounded-md border px-3 py-2 text-sm"
          >
            {copied ? t("rotateCopied") : t("rotateCopy")}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("rotateCarried")}</p>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border px-4 py-3 ${alarmed ? "border-amber-500/40 bg-amber-500/10" : "bg-card"}`}>
      <h3 className="text-sm font-semibold">{t("rotateTitle")}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t("rotateWhy")}</p>
      {phase === "failed" && <p className="mt-2 text-sm">{t("rotateFailed")}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {phase === "confirm" ? (
          <>
            <button
              type="button"
              onClick={rotate}
              className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white"
            >
              {t("rotateConfirm")}
            </button>
            <button type="button" onClick={() => setPhase("idle")} className="rounded-md border px-4 py-2 text-sm">
              {t("rotateCancel")}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={phase === "working"}
            onClick={() => setPhase("confirm")}
            className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {phase === "working" ? t("rotateWorking") : t("rotateButton")}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The way out.
 *
 * Revocation, the 30-day deletion and the DPA clause behind it all existed
 * already: `/v1/keys/revoke` is self-service and authenticated by the key
 * itself, and `purgeTerminatedKeyTelemetry` runs on its own and is watched.
 * None of it was ever said to the customer, so the whole exit path was real
 * and invisible — the same shape as this page being reachable from no link at
 * all a few hours ago.
 *
 * Nothing here changes a policy. It states, where a customer can act on it,
 * what the product already does.
 */
function Leave({ apiKey, locale }: { apiKey: string; locale: string }) {
  const t = useTranslations("account");
  const [phase, setPhase] = useState<"idle" | "confirm" | "working" | "done" | "failed">("idle");

  async function revoke() {
    setPhase("working");
    try {
      const res = await fetch(`${API_URL}/v1/keys/revoke`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      setPhase(res.ok ? "done" : "failed");
    } catch {
      setPhase("failed");
    }
  }

  if (phase === "done") {
    return (
      <div className="rounded-lg border px-4 py-3">
        <p className="text-sm">{t("leaveDone")}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border px-4 py-3">
      <h3 className="text-sm font-semibold">{t("leaveTitle")}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t("leaveWhy")}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t("leaveRetention")}</p>
      {phase === "failed" && <p className="mt-2 text-sm">{t("leaveFailed")}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {phase === "confirm" ? (
          <>
            <button
              type="button"
              onClick={revoke}
              className="rounded-md border border-destructive px-4 py-2 text-sm font-medium text-destructive"
            >
              {t("leaveConfirm")}
            </button>
            <button type="button" onClick={() => setPhase("idle")} className="rounded-md border px-4 py-2 text-sm">
              {t("leaveCancel")}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={phase === "working"}
            onClick={() => setPhase("confirm")}
            className="rounded-md border px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {phase === "working" ? t("leaveWorking") : t("leaveButton")}
          </button>
        )}
        <a href={`/${locale}/legal/dpa`} className="text-sm text-muted-foreground underline underline-offset-2">
          {t("leaveDpa")}
        </a>
      </div>
    </div>
  );
}

/**
 * The state a buyer actually lands in, and the one this page did not have.
 *
 * Measured on 30/08/2026: five paying customers, zero calls in thirty days.
 * This page is what the purchase e-mail points at, and until 2026-09-01 it
 * answered someone who had never called with an empty usage report — a reading
 * of a past that does not exist yet. It contained no `curl`, no `Bearer` and no
 * snippet of any kind (BIZ-09 / WEB-04b, audit 2026-09-01).
 *
 * So: the first call, written out with the key the visitor just pasted, and a
 * button that fires it from this page. The command is the same one the docs
 * give, deliberately — what is copied here must be what works there.
 *
 * The call goes browser to API, like every other call on this page: the key
 * never reaches our own server, which is the claim the file header makes and
 * the reason this page needs no session.
 */
const FIRST_CALL_IBAN = "CH9300762011623852957";

type CallPhase =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; status: number; body: string }
  | { kind: "failed" };

function FirstCall({ apiKey }: { apiKey: string }) {
  const t = useTranslations("account");
  const [phase, setPhase] = useState<CallPhase>({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  const command = [
    `curl -X POST ${API_URL}/v1/iban/validate \\`,
    `  -H "Authorization: Bearer ${apiKey}" \\`,
    '  -H "Content-Type: application/json" \\',
    `  -d '{"iban":"${FIRST_CALL_IBAN}"}'`,
  ].join("\n");

  async function run() {
    setPhase({ kind: "running" });
    try {
      const res = await fetch(`${API_URL}/v1/iban/validate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ iban: FIRST_CALL_IBAN }),
      });
      // The body is shown whatever the status: a 402 or a 429 is an answer the
      // caller needs to read, not a failure of this page.
      const raw = await res.text();
      let body = raw;
      try {
        body = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        // Not JSON. Show it as it came rather than swallowing it.
      }
      setPhase({ kind: "done", status: res.status, body });
    } catch {
      // Network failure, CORS, offline. The key was still sent nowhere else.
      setPhase({ kind: "failed" });
    }
  }

  return (
    <section className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-4">
      <h2 className="font-heading text-lg font-semibold">{t("firstCallTitle")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("firstCallBody")}</p>

      <pre className="mt-3 overflow-x-auto rounded bg-background px-3 py-3 font-mono text-xs leading-relaxed">
        {command}
      </pre>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(command).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
          className="rounded-md border px-4 py-2 text-sm"
        >
          {copied ? t("firstCallCopied") : t("firstCallCopy")}
        </button>
        <button
          type="button"
          onClick={run}
          disabled={phase.kind === "running"}
          className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {phase.kind === "running" ? t("firstCallRunning") : t("firstCallRun")}
        </button>
      </div>

      {phase.kind === "failed" && <p className="mt-3 text-sm">{t("firstCallFailed")}</p>}

      {phase.kind === "done" && (
        <div className="mt-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("firstCallResult")} · HTTP {phase.status}
          </div>
          <pre className="mt-2 max-h-80 overflow-auto rounded bg-background px-3 py-3 font-mono text-xs leading-relaxed">
            {phase.body}
          </pre>
        </div>
      )}
    </section>
  );
}

export function AccountApp({ locale }: { locale: string }) {
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
          {/* Nothing was ever called with this key: the report below has no past
              to show, so the first call comes first (BIZ-09). Both counters are
              read, not just the monthly one — a key that called last month and
              not this one has a history worth reading and is not a new buyer. */}
          {d.usage.used === 0 && d.report.total === 0 && <FirstCall apiKey={key.trim()} />}

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

          <Rotate apiKey={key.trim()} alarmed={d.report.footprint.unusual === true} />
          <Leave apiKey={key.trim()} locale={locale} />
        </div>
      )}
    </div>
  );
}
