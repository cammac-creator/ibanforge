"use client";

import { useTranslations } from "next-intl";

export interface AuditStatus {
  job: string;
  rows: number;
  tier: string;
  price_chf: number;
  currency: string;
  lang: string;
  paid: boolean;
  paid_at: string | null;
  expires_at: string;
  summary: {
    rows: number;
    ok: number;
    warning: number;
    error: number;
    by_code: Record<string, number>;
    countries: Array<{ code: string; rows: number }>;
    columns_detected: string[];
    address_checked: boolean;
  };
  preview: Array<{
    line: number;
    iban_masked: string;
    status: "ok" | "warning" | "error";
    findings: string[];
    bank_name: string | null;
  }>;
  download: string | null;
}

const STATUS_CLASS: Record<string, string> = {
  ok: "text-emerald-700 dark:text-emerald-400",
  warning: "text-amber-700 dark:text-amber-400",
  error: "text-red-700 dark:text-red-400",
};

export function AuditSummaryView({ status, masked }: { status: AuditStatus; masked: boolean }) {
  const t = useTranslations("audit");
  const s = status.summary;
  const codes = Object.entries(s.by_code).sort((a, b) => b[1] - a[1]);
  return (
    <div className="flex flex-col gap-6 print:gap-4">
      <p className="rounded-lg border border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20 p-4 text-sm leading-relaxed">
        {t("preview.meaning", { errors: s.error, warnings: s.warning })}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label={t("preview.rows")} value={s.rows} />
        <Stat label={t("status.ok")} value={s.ok} tone="ok" />
        <Stat label={t("status.warning")} value={s.warning} tone="warning" />
        <Stat label={t("status.error")} value={s.error} tone="error" />
      </div>

      {codes.length > 0 ? (
        <div className="rounded-lg border p-5 flex flex-col gap-2">
          <h3 className="font-semibold">{t("preview.byType")}</h3>
          <ul className="text-sm flex flex-col gap-1">
            {codes.map(([code, n]) => (
              <li key={code} className="flex justify-between gap-4">
                <span>{findingLabel(t, code)}</span>
                <span className="font-mono tabular-nums">{n}</span>
              </li>
            ))}
          </ul>
          {!s.address_checked ? (
            <p className="text-xs text-muted-foreground mt-2">{t("preview.noAddress")}</p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("preview.clean")}</p>
      )}

      {status.preview.length > 0 ? (
        <div className="rounded-lg border overflow-x-auto print:hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{t("preview.table.line")}</th>
                <th className="px-3 py-2 font-medium">{t("preview.table.iban")}</th>
                <th className="px-3 py-2 font-medium">{t("preview.table.status")}</th>
                <th className="px-3 py-2 font-medium">{t("preview.table.findings")}</th>
                <th className="px-3 py-2 font-medium">{t("preview.table.bank")}</th>
              </tr>
            </thead>
            <tbody>
              {status.preview.map((row) => (
                <tr key={row.line} className="border-t">
                  <td className="px-3 py-2 font-mono tabular-nums">{row.line}</td>
                  <td className="px-3 py-2 font-mono">{row.iban_masked}</td>
                  <td className={`px-3 py-2 font-medium ${STATUS_CLASS[row.status] ?? ""}`}>{t(`status.${row.status}`)}</td>
                  <td className="px-3 py-2">{row.findings.map((c) => findingLabel(t, c)).join(" ; ")}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.bank_name ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {masked ? (
            <p className="px-3 py-2 text-xs text-muted-foreground border-t">
              {t("preview.more", { shown: status.preview.length, rows: s.rows })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warning" | "error" }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${tone ? STATUS_CLASS[tone] : ""}`}>{value}</p>
    </div>
  );
}

const KNOWN = new Set([
  "iban_missing",
  "iban_invalid",
  "bank_code_not_allocated",
  "modulus_check_failed",
  "sepa_not_reachable",
  "test_bic",
  "bic_mismatch",
  "country_mismatch",
  "duplicate",
  "issuer_not_bank",
  "country_risk",
  "address_not_structured",
]);

function findingLabel(t: ReturnType<typeof useTranslations>, code: string): string {
  return KNOWN.has(code) ? t(`findings.${code}`) : code;
}
