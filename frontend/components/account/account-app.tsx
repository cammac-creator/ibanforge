"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ExternalLink, Loader2 } from "lucide-react";
import { localePath } from "@/lib/locale-path";
import { formatGrouped } from "@/lib/format-grouped";
import {
  CHECKING,
  NETWORK_FAILURE,
  afterCodeRequest,
  afterLogout,
  afterOverview,
  afterSignIn,
  formatUtcStamp,
  isCompleteCode,
  normalizeCode,
  readReport,
  resendWaitSeconds,
  sheetFromReport,
  type AccountScreen,
  type ApiReply,
  type KeyReport,
  type KeyReportPayload,
  type KeySheet,
  type Notice,
} from "@/lib/account-overview";

/**
 * La page du compte client, en deux modes.
 *
 * 1. Par défaut, la connexion par adresse e-mail et code à six chiffres
 *    (API du lot C1). Le navigateur appelle l'API DIRECTEMENT, avec
 *    `credentials: 'include'` : c'est l'API qui pose le cookie de session
 *    (`ibanforge_account`, httpOnly, `SameSite=Strict`, `Path=/v1/account`)
 *    sur son propre hôte. Aucune route Next, aucune action serveur : l'API voit
 *    la vraie adresse IP du client, et ses plafonds par réseau restent justes.
 *    La page ne voit jamais le jeton, ne garde l'adresse qu'en mémoire (ni
 *    stockage du navigateur, ni URL) et ne fait que lire.
 *
 * 2. Le repli « coller une clé », inchangé dans son principe : la clé va de ce
 *    composant à l'API et nulle part ailleurs, jamais vers nos serveurs. Lui
 *    seul renouvelle ou révoque une clé (plan §2.3) : une adresse e-mail ne
 *    prouve pas qui utilise la clé.
 *
 * Les deux modes rendent la MÊME fiche de clé (`KeySheetCard`), construite par
 * le même code (`lib/account-overview.ts`), et le même rapport de 30 jours.
 * Le repli se rend à l'identique dans un déploiement de prévisualisation ; la
 * connexion, elle, suppose le même site que l'API (ibanforge.com).
 *
 * Ni `Intl` ni `toLocale*` ici (règle 8 d'AGENTS.md) : les nombres passent par
 * `formatGrouped`, les dates par `formatUtcStamp`.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.ibanforge.com";

/**
 * Un appel aux routes du compte : cookie compris, jamais de cache. Ne rejette
 * jamais : une panne (réseau, CORS) devient `status: 0`, que la page lit comme
 * les autres réponses. Un 204 n'a pas de corps à lire.
 */
async function callAccount(path: string, init: RequestInit = {}): Promise<ApiReply> {
  try {
    const res = await fetch(`${API_URL}${path}`, { ...init, credentials: "include", cache: "no-store" });
    if (res.status === 204) return { status: 204, body: null };
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return NETWORK_FAILURE;
  }
}

/** Les routes d'écriture exigent `application/json` : c'est ce qui force le preflight CORS. */
function postAccount(path: string, body: Record<string, unknown>): Promise<ApiReply> {
  return callAccount(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Le texte de chaque message, dans l'espace `account`. */
const NOTICE_TEXT: Record<Notice, string> = {
  code_invalid: "errorCode",
  code_attempts: "errorAttempts",
  rate_limited: "errorRateLimited",
  address: "errorAddress",
  service: "errorService",
  session_ended: "sessionEnded",
  load_failed: "loadFailed",
};

function NoticeBox({ notice }: { notice: Notice }) {
  const t = useTranslations("account");
  return (
    <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      {t(NOTICE_TEXT[notice])}
    </p>
  );
}

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
        <a href={localePath(locale, '/legal/dpa')} className="text-sm text-muted-foreground underline underline-offset-2">
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

/**
 * Le rapport de 30 jours d'une clé, le même dans les deux modes : il vient de
 * `/v1/keys/report` (clé collée) ou de `/v1/account/keys/report` (connecté),
 * deux routes qui servent le même corps, construit par `getKeyReport`.
 */
function KeyReportDetail({ report, locale }: { report: KeyReport; locale: string }) {
  const t = useTranslations("account");
  return (
    <div className="space-y-6">
      <div>
        <Days days={report.days} span={report.window_days} />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Stat label={t("served")} value={formatGrouped(report.ok, locale)} />
          <Stat label={t("failed")} value={formatGrouped(report.failed, locale)} />
          <Stat label={t("avgMs")} value={report.avg_ms == null ? "—" : `${report.avg_ms} ms`} />
        </div>
      </div>

      {report.endpoints.length > 0 && (
        <section>
          <h3 className="mb-3 font-heading text-base font-semibold">{t("endpointsTitle")}</h3>
          <ul className="space-y-1">
            {report.endpoints.map((e) => (
              <li key={e.path} className="flex items-baseline justify-between gap-4 text-sm">
                <span className="min-w-0 truncate font-mono text-muted-foreground">{e.path}</span>
                <span className="font-mono tabular-nums">{formatGrouped(e.count, locale)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-3 font-heading text-base font-semibold">{t("errorsTitle")}</h3>
        {report.errors.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noErrors")}</p>
        ) : (
          <ul className="space-y-3">
            {report.errors.map((e) => (
              <li key={`${e.path} ${e.status}`} className="rounded-lg border bg-card px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
                  <span className="font-mono font-semibold">{e.status}</span>
                  <span className="min-w-0 truncate font-mono text-muted-foreground">{e.path}</span>
                  <span className="ml-auto font-mono tabular-nums">{formatGrouped(e.count, locale)}</span>
                </div>
                <p className="mt-1 text-sm">{e.meaning}</p>
                {e.fix && <p className="mt-0.5 text-sm text-muted-foreground">{e.fix}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-3 font-heading text-base font-semibold">{t("footprintTitle")}</h3>
        <div
          className={`rounded-lg border px-4 py-3 ${
            report.footprint.unusual === true ? "border-amber-500/40 bg-amber-500/10" : "bg-card"
          }`}
        >
          <div className="font-mono text-2xl tabular-nums">
            {report.footprint.distinct_networks}{" "}
            <span className="text-sm font-normal text-muted-foreground">{t("networks")}</span>
          </div>
          <p className="mt-1 text-sm">
            {report.footprint.unusual == null
              ? t("footprintUnknown")
              : report.footprint.unusual
                ? t("footprintUnusual")
                : t("footprintCalm")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t("footprintHint")}</p>
        </div>
      </section>
    </div>
  );
}

/**
 * LA fiche d'une clé, pour les deux modes (plan §6 : formule, reste du mois,
 * crédits restants, appels du mois, dernier appel, alertes envoyées, portail
 * de l'abonnement). Une ligne que la source ne sert pas ne s'affiche pas : la
 * clé collée ne dit ni sa formule, ni ses alertes, ni son dernier appel.
 *
 * 🚨 Le « reste » d'une clé à crédits n'est jamais montré : il est calculé
 * contre le plafond du palier gratuit, que cette clé ne porte pas, et rien ne
 * lui est opposé (voir `lib/account-credits.ts`). C'est le solde qui compte.
 */
function KeySheetCard({ sheet, locale, children }: { sheet: KeySheet; locale: string; children?: ReactNode }) {
  const t = useTranslations("account");
  const planLabel = sheet.plan
    ? sheet.plan.parts.length > 0
      ? sheet.plan.parts.map((part) => t(`plans.${part}`)).join(" + ")
      : sheet.plan.raw
    : null;
  const lastCall = sheet.lastCall ? (formatUtcStamp(sheet.lastCall.at) ?? t("lastCallNone")) : null;
  const shownAlerts = sheet.alerts?.slice(0, 3) ?? [];
  const olderAlerts = (sheet.alerts?.length ?? 0) - shownAlerts.length;
  const tiles = [sheet.allowance, sheet.credits, sheet.callsThisMonth].filter((v) => v !== null).length;

  return (
    <article className="rounded-xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-4 py-3 sm:px-5">
        <h2 className="font-mono text-base font-semibold">{sheet.prefix}</h2>
        {planLabel && (
          <p className="text-sm">
            <span className="text-muted-foreground">{t("plan")} · </span>
            <span className="font-medium">{planLabel}</span>
          </p>
        )}
      </header>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        <div className={`grid gap-3 ${tiles >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          {sheet.allowance && (
            <Stat
              // Une allocation mesurée sur la vie de la clé n'est pas « ce mois-ci ».
              label={sheet.allowance.lifetime ? t("remaining") : t("leftThisMonth")}
              value={formatGrouped(sheet.allowance.remaining, locale)}
              hint={
                sheet.allowance.limit === null
                  ? undefined
                  : t("leftOf", { limit: formatGrouped(sheet.allowance.limit, locale) })
              }
            />
          )}
          {sheet.credits && (
            <Stat
              label={t("credits")}
              value={sheet.credits.remaining === null ? "—" : formatGrouped(sheet.credits.remaining, locale)}
              hint={
                sheet.credits.total === null
                  ? undefined
                  : t("creditsOf", { total: formatGrouped(sheet.credits.total, locale) })
              }
            />
          )}
          {sheet.callsThisMonth !== null && (
            <Stat
              label={t("callsThisMonth")}
              value={formatGrouped(sheet.callsThisMonth, locale)}
              hint={sheet.month ?? undefined}
            />
          )}
        </div>

        {/* La note des crédits dit qu'aucun quota mensuel n'est opposé à la
            clé : vrai pour un pack seul, faux pour une clé mixte (après B1),
            qui garde son allocation gratuite. */}
        {sheet.credits && !sheet.allowance && <p className="text-sm text-muted-foreground">{t("creditsNote")}</p>}

        {(lastCall !== null || sheet.alerts !== null) && (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
            {lastCall !== null && (
              <>
                <dt className="text-muted-foreground">{t("lastCall")}</dt>
                <dd className="font-mono tabular-nums">{lastCall}</dd>
              </>
            )}
            {sheet.alerts !== null && (
              <>
                <dt className="text-muted-foreground">{t("alertsSent")}</dt>
                <dd>
                  {shownAlerts.length === 0 ? (
                    t("alertsNone")
                  ) : (
                    <ul className="space-y-0.5">
                      {shownAlerts.map((a, i) => (
                        <li key={`${a.kind} ${a.sentAt ?? ""} ${i}`}>
                          {t(`alertKinds.${a.kind}`)}
                          {formatUtcStamp(a.sentAt) && (
                            <span className="font-mono text-muted-foreground tabular-nums">
                              {" · "}
                              {formatUtcStamp(a.sentAt)}
                            </span>
                          )}
                        </li>
                      ))}
                      {olderAlerts > 0 && <li className="text-muted-foreground tabular-nums">+{olderAlerts}</li>}
                    </ul>
                  )}
                </dd>
              </>
            )}
          </dl>
        )}

        {sheet.manageUrl && (
          <a
            href={sheet.manageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted/50"
          >
            {t("manageSubscription")}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
      </div>

      {children}
    </article>
  );
}

type ReportState = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; report: KeyReport } | { kind: "failed" };

/**
 * Une clé du compte : sa fiche, et son rapport de 30 jours chargé à la demande
 * (`GET /v1/account/keys/report?prefix=…`, le préfixe en PARAMÈTRE et non dans
 * le chemin : écart assumé du lot C1). La vue d'ensemble ne lit pas le détail
 * de chaque clé : une adresse d'éditeur peut en porter des dizaines.
 */
function ConnectedKey({
  sheet,
  locale,
  onSessionEnded,
}: {
  sheet: KeySheet;
  locale: string;
  onSessionEnded: () => void;
}) {
  const t = useTranslations("account");
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<ReportState>({ kind: "idle" });
  const panelId = `report-${sheet.prefix}`;

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (report.kind === "ready" || report.kind === "loading") return;
    setReport({ kind: "loading" });
    const outcome = readReport(
      await callAccount(`/v1/account/keys/report?prefix=${encodeURIComponent(sheet.prefix)}&days=30`),
    );
    if (outcome.kind === "session_ended") {
      onSessionEnded();
      return;
    }
    setReport(outcome.kind === "ready" ? { kind: "ready", report: outcome.payload.report } : { kind: "failed" });
  }

  return (
    <KeySheetCard sheet={sheet} locale={locale}>
      <div className="border-t">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex w-full items-center justify-between gap-3 rounded-b-xl px-4 py-3 text-left text-sm font-medium hover:bg-muted/40 sm:px-5"
        >
          {t("windowTitle")}
          <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {open && (
          <div id={panelId} className="px-4 pb-5 sm:px-5">
            {report.kind === "loading" && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {t("loading")}
              </p>
            )}
            {report.kind === "failed" && <NoticeBox notice="load_failed" />}
            {report.kind === "ready" && <KeyReportDetail report={report.report} locale={locale} />}
          </div>
        )}
      </div>
    </KeySheetCard>
  );
}

/** Le temps de lire la vue : le même rendu au serveur et au navigateur. */
function Checking() {
  const t = useTranslations("account");
  return (
    <div className="rounded-xl border bg-card p-5 sm:p-6" aria-busy="true">
      <span className="sr-only">{t("loading")}</span>
      <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
      <div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-muted" />
      <div className="mt-6 h-10 w-full animate-pulse rounded-md bg-muted" />
    </div>
  );
}

const PRIMARY_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50";
const QUIET_LINK = "text-left text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground";

function AccountBar({
  email,
  busy,
  onSignOut,
}: {
  email: string;
  busy: boolean;
  onSignOut: (everywhere: boolean) => void;
}) {
  const t = useTranslations("account");
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl border bg-card px-4 py-3 sm:px-5">
      <p className="min-w-0 break-words text-sm font-medium">{t("signedInAs", { email })}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onSignOut(false)}
          disabled={busy}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted/50 disabled:opacity-50"
        >
          {t("signOut")}
        </button>
        <button
          type="button"
          onClick={() => onSignOut(true)}
          disabled={busy}
          className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {t("signOutEverywhere")}
        </button>
      </div>
    </div>
  );
}

/**
 * Le mode par défaut : l'adresse, le code, puis les clés de l'adresse.
 *
 * Aucun champ ne porte d'attribut `name` : un formulaire envoyé avant que
 * React ne soit prêt partirait en GET natif, et l'adresse finirait dans l'URL.
 * De toute façon le formulaire n'apparaît qu'après le premier appel à l'API,
 * donc après l'hydratation.
 */
function EmailMode({
  locale,
  screen,
  setScreen,
  onPaste,
}: {
  locale: string;
  screen: AccountScreen;
  setScreen: (next: AccountScreen | ((prev: AccountScreen) => AccountScreen)) => void;
  onPaste: () => void;
}) {
  const t = useTranslations("account");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  // L'horloge du renvoi : posée au geste d'envoi, avancée par le minuteur.
  // `Date.now()` n'est jamais appelé pendant le rendu (règle react-hooks/purity).
  const [clock, setClock] = useState(0);
  const sentAt = screen.kind === "code_sent" ? screen.sentAt : null;
  const wait = sentAt === null ? 0 : resendWaitSeconds(sentAt, clock);

  useEffect(() => {
    if (sentAt === null) return;
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sentAt]);

  // Le code est la seule chose à faire sur son écran, qui s'ouvre sur le geste
  // « Recevoir un code » : le curseur y va (iOS propose alors le code reçu).
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (sentAt !== null) codeInput.current?.focus();
  }, [sentAt]);

  async function requestCode(address: string) {
    if (!address || busy) return;
    setBusy(true);
    const reply = await postAccount("/v1/account/code", { email: address });
    const now = Date.now();
    setClock(now);
    if (reply.status === 202) setCode("");
    setScreen((prev) => afterCodeRequest(reply, address, now, prev));
    setBusy(false);
  }

  async function signIn(e: FormEvent) {
    e.preventDefault();
    if (screen.kind !== "code_sent" || busy) return;
    const typed = normalizeCode(code);
    if (!isCompleteCode(typed)) return;
    setBusy(true);
    const next = afterSignIn(await postAccount("/v1/account/session", { email: screen.email, code: typed }), screen);
    setScreen(next);
    if (next.kind === "opening") {
      const view = await callAccount("/v1/account/overview");
      // Connecté, l'adresse affichée vient de l'API ; celle du champ s'efface.
      setCode("");
      setEmail("");
      setScreen((prev) => afterOverview(view, prev));
    }
    setBusy(false);
  }

  async function signOut(everywhere: boolean) {
    if (busy) return;
    setBusy(true);
    const reply = await postAccount("/v1/account/logout", everywhere ? { all: true } : {});
    setScreen((prev) => afterLogout(reply, prev));
    setBusy(false);
  }

  async function goToPage(page: number) {
    if (busy) return;
    setBusy(true);
    const reply = await callAccount(`/v1/account/overview?page=${page}`);
    setScreen((prev) => afterOverview(reply, prev));
    setBusy(false);
  }

  function sessionEnded() {
    setScreen({ kind: "signed_out", notice: "session_ended" });
  }

  if (screen.kind === "checking" || screen.kind === "opening") return <Checking />;

  if (screen.kind === "signed_out") {
    return (
      <section className="space-y-4 rounded-xl border bg-card p-5 sm:p-6">
        {screen.notice === "session_ended" && <NoticeBox notice="session_ended" />}
        <p className="text-sm leading-relaxed">{t("signInIntro")}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void requestCode(email.trim());
          }}
          className="space-y-2"
        >
          <label htmlFor="account-email" className="block text-sm font-medium">
            {t("emailLabel")}
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="account-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-w-0 flex-1 basis-60 rounded-md border bg-background px-3 py-2 text-base sm:text-sm"
            />
            <button type="submit" disabled={busy || !email.trim()} className={PRIMARY_BUTTON}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("sendCode")}
            </button>
          </div>
        </form>
        {screen.notice && screen.notice !== "session_ended" && <NoticeBox notice={screen.notice} />}
        <button type="button" onClick={onPaste} className={QUIET_LINK}>
          {t("pasteInstead")}
        </button>
      </section>
    );
  }

  if (screen.kind === "code_sent") {
    return (
      <section className="space-y-4 rounded-xl border bg-card p-5 sm:p-6">
        <p className="break-words text-sm leading-relaxed">{t("codeSent", { email: screen.email })}</p>
        <form onSubmit={signIn} className="space-y-2">
          <label htmlFor="account-code" className="block text-sm font-medium">
            {t("codeLabel")}
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="account-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              ref={codeInput}
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value.slice(0, 12))}
              className="w-44 rounded-md border bg-background px-3 py-2 font-mono text-lg tracking-[0.25em] tabular-nums"
            />
            <button type="submit" disabled={busy || !isCompleteCode(normalizeCode(code))} className={PRIMARY_BUTTON}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("signIn")}
            </button>
          </div>
        </form>
        {screen.notice && <NoticeBox notice={screen.notice} />}
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <button
            type="button"
            onClick={() => void requestCode(screen.email)}
            disabled={busy || wait > 0}
            className={`${QUIET_LINK} disabled:no-underline disabled:opacity-60`}
          >
            {t("resendCode")}
            {wait > 0 && <span className="tabular-nums">{` · ${wait} s`}</span>}
          </button>
          <button
            type="button"
            onClick={() => {
              setCode("");
              setEmail(screen.email);
              setScreen({ kind: "signed_out", notice: null });
            }}
            className={QUIET_LINK}
          >
            {t("otherAddress")}
          </button>
        </div>
      </section>
    );
  }

  if (screen.kind === "no_keys") {
    return (
      <div className="space-y-6">
        <AccountBar email={screen.email} busy={busy} onSignOut={signOut} />
        {screen.notice && <NoticeBox notice={screen.notice} />}
        <section className="space-y-4 rounded-xl border bg-card p-5 sm:p-6">
          <p className="break-words text-sm leading-relaxed">{t("noKeys", { email: screen.email })}</p>
          <button type="button" onClick={onPaste} className={QUIET_LINK}>
            {t("pasteInstead")}
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AccountBar email={screen.email} busy={busy} onSignOut={signOut} />
      {screen.notice && <NoticeBox notice={screen.notice} />}
      <div className="space-y-5">
        {screen.keys.map((sheet) => (
          <ConnectedKey key={sheet.prefix} sheet={sheet} locale={locale} onSessionEnded={sessionEnded} />
        ))}
      </div>
      {screen.pages > 1 && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <button
            type="button"
            onClick={() => void goToPage(screen.page - 1)}
            disabled={busy || screen.page <= 1}
            className="rounded-md border px-3 py-1.5 disabled:opacity-40"
          >
            {t("pagePrev")}
          </button>
          <span className="tabular-nums text-muted-foreground">
            {screen.page} / {screen.pages}
          </span>
          <button
            type="button"
            onClick={() => void goToPage(screen.page + 1)}
            disabled={busy || screen.page >= screen.pages}
            className="rounded-md border px-3 py-1.5 disabled:opacity-40"
          >
            {t("pageNext")}
          </button>
        </div>
      )}
      <button type="button" onClick={onPaste} className={QUIET_LINK}>
        {t("rotateNeedsKey")}
      </button>
    </div>
  );
}

type PasteState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "unreachable" }
  | { kind: "ready"; data: KeyReportPayload };

/**
 * Le repli « coller une clé ». Son principe ne change pas : la clé est lue de
 * ce champ vers un `fetch` sur l'hôte de l'API, et nulle part ailleurs ; pas de
 * cookie (les routes des clés n'en lisent pas), pas de route Next. Quitter ce
 * mode démonte le composant : la clé collée disparaît avec lui.
 */
function PasteMode({ locale, onEmail }: { locale: string; onEmail: () => void }) {
  const t = useTranslations("account");
  const [key, setKey] = useState("");
  const [state, setState] = useState<PasteState>({ kind: "idle" });

  async function submit(e: FormEvent) {
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
      setState({ kind: "ready", data: (await res.json()) as KeyReportPayload });
    } catch {
      // Network failure, CORS, offline. Never blame the key for this.
      setState({ kind: "unreachable" });
    }
  }

  const d = state.kind === "ready" ? state.data : null;
  // La fiche, construite par le même code que celle du compte connecté.
  const sheet = d ? sheetFromReport(d) : null;

  return (
    <div className="space-y-8">
      <div className="space-y-4">
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
        <button type="button" onClick={onEmail} className={QUIET_LINK}>
          {t("useEmail")}
        </button>
      </div>

      {state.kind === "invalid" && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">{t("invalid")}</p>
      )}
      {state.kind === "unreachable" && (
        <p className="rounded-md border px-4 py-3 text-sm text-muted-foreground">{t("unreachable")}</p>
      )}

      {d && sheet && (
        <div className="space-y-8">
          {/* Nothing was ever called with this key: the report below has no past
              to show, so the first call comes first (BIZ-09). Both counters are
              read, not just the monthly one — a key that called last month and
              not this one has a history worth reading and is not a new buyer. */}
          {d.usage.used === 0 && d.report.total === 0 && <FirstCall apiKey={key.trim()} />}

          <KeySheetCard sheet={sheet} locale={locale}>
            <section className="border-t px-4 py-4 sm:px-5">
              <h3 className="mb-3 text-sm font-medium">{t("windowTitle")}</h3>
              <KeyReportDetail report={d.report} locale={locale} />
            </section>
          </KeySheetCard>

          <Rotate apiKey={key.trim()} alarmed={d.report.footprint.unusual === true} />
          <Leave apiKey={key.trim()} locale={locale} />
        </div>
      )}
    </div>
  );
}

export function AccountApp({ locale }: { locale: string }) {
  const [mode, setMode] = useState<"email" | "paste">("email");
  const [screen, setScreen] = useState<AccountScreen>(CHECKING);

  // Au chargement, une seule question à l'API : ce navigateur porte-t-il une
  // session ? Le cookie est httpOnly, seule la réponse le dit. L'état ne change
  // qu'à la réponse (jamais pendant l'effet lui-même).
  useEffect(() => {
    let live = true;
    void callAccount("/v1/account/overview").then((reply) => {
      if (live) setScreen((prev) => afterOverview(reply, prev));
    });
    return () => {
      live = false;
    };
  }, []);

  if (mode === "paste") return <PasteMode locale={locale} onEmail={() => setMode("email")} />;
  return <EmailMode locale={locale} screen={screen} setScreen={setScreen} onPaste={() => setMode("paste")} />;
}
