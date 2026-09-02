import { getTranslations } from "next-intl/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://api.ibanforge.com";

/** The deliverable, drawn as a spreadsheet: the customer's columns, then the audit's. */
export async function AuditWorkbookPreview({ locale }: { locale: string }) {
  const t = await getTranslations("audit");
  const cols = t.raw("workbook.cols") as string[];
  const rows = t.raw("workbook.rows") as string[][];
  const errorWord = t("workbook.status.error");
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold">{t("workbook.title")}</h2>
      <p className="text-sm text-muted-foreground leading-relaxed max-w-prose">{t("workbook.text")}</p>
      <div className="rounded-lg border overflow-x-auto bg-background">
        <table className="w-full text-[11px] sm:text-xs border-collapse">
          <thead>
            <tr className="bg-muted/50">
              {cols.map((c, i) => (
                <th
                  key={c}
                  className={`px-2 py-1.5 text-left font-medium align-top ${i >= 2 ? "border-l border-amber-500/40 bg-amber-500/5" : ""}`}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className="border-t">
                {r.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`px-2 py-1.5 align-top ${ci === 1 ? "font-mono whitespace-nowrap" : ""} ${ci >= 2 ? "border-l border-amber-500/40 bg-amber-500/5" : ""} ${
                      ci === 2 ? (cell === errorWord ? "font-medium text-red-700 dark:text-red-400" : "font-medium text-emerald-700 dark:text-emerald-400") : ""
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <a
        href={`${API_BASE}/v1/audit/sample-report.xlsx?lang=${locale}`}
        className="text-sm underline underline-offset-4 w-fit"
      >
        {t("workbook.sample")}
      </a>
    </section>
  );
}
