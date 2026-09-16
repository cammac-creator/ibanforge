"use client";

import { useTranslations } from "next-intl";
import { playgroundVerdict } from "@/lib/playground-verdict";

/** Les preuves de banque et de BIC gardent chacune leur propre provenance. */
export function VerificationSummary({ data, mode }: { data: Record<string, unknown>; mode: "iban" | "compliance" }) {
  const t = useTranslations("playground.verdict");
  const v = playgroundVerdict(data, mode);
  const rows = [
    { label: t("structure"), value: t(v.structure), detail: t("structureScope") },
    { label: t("bankCode"), value: `${v.code ? `${v.code} · ` : ""}${t(v.bankStatus)}`, detail: v.bankName,
      source: v.source, date: v.asOf, alert: v.bankStatus === "notAllocated" },
    { label: "BIC", value: v.bic ?? t("unknown"), detail: [v.bicBankName, t("bicScope")].filter(Boolean).join(" · "), source: v.bicSource, date: v.bicAsOf },
    { label: t("sanctions"), value: t(v.sanctions), detail: t("sanctionsScope"), source: v.sanctionsSource, date: v.sanctionsAsOf,
      alert: v.sanctions === "matchedSanctions" },
    { label: t("holder"), value: t("notChecked"), detail: t("holderScope") },
  ];
  return (
    <section className="border-b border-[var(--hairline)] p-4 sm:p-5" aria-label={t("title")}>
      <h3 className="text-base font-semibold mb-4">{t("title")}</h3>
      <dl className="grid gap-3 sm:grid-cols-2">
        {rows.map(row => (
          <div key={row.label} className={`min-w-0 rounded-lg border p-4 ${row.alert ? "border-red-500/40 bg-red-500/5" : "border-[var(--ink-4)] bg-[var(--ink-2)]/40"}`}>
            <dt className="text-xs text-[var(--fg-3)]">{row.label}</dt>
            <dd className="m-0 mt-1 text-sm font-semibold break-words">{row.value}</dd>
            {row.detail ? <dd className="m-0 mt-2 text-xs leading-relaxed text-[var(--fg-3)] break-words">{row.detail}</dd> : null}
            {row.source ? <dd className="m-0 mt-2 text-xs leading-relaxed text-[var(--fg-3)] break-words">{t("source")} : {row.source}<br />{t("date")} : {row.date ?? t("notProvided")}</dd> : null}
          </div>
        ))}
      </dl>
      {v.localCheckInvalid ? <p role="alert" className="mt-4 rounded-lg border border-red-500/40 p-3 text-sm">{t("localCheckInvalid")}</p> : null}
      <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm leading-relaxed">
        <strong>{t("nextTitle")} : </strong>{t(v.next)}
      </p>
    </section>
  );
}
