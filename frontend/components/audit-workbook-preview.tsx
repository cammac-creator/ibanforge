import { getTranslations } from "next-intl/server";
import Image from "next/image";
import { auditImageFor } from "@/lib/audit-images";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://api.ibanforge.com";

/** Aperçu fictif du livrable et tableau accessible des mêmes lignes. */
export async function AuditWorkbookPreview({ locale }: { locale: string }) {
  const t = await getTranslations("audit");
  const cols = t.raw("workbook.cols") as string[];
  const rows = t.raw("workbook.rows") as string[][];
  const errorWord = t("workbook.status.error");
  const image = auditImageFor(locale);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold">{t("workbook.title")}</h2>
      <p className="text-sm text-muted-foreground leading-relaxed max-w-prose">{t("workbook.text")}</p>
      <figure className="flex flex-col gap-2">
        <a href={image.src} target="_blank" rel="noopener noreferrer" className="block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4">
          <Image src={image.src} width={image.width} height={image.height} alt={t("workbook.imageAlt")} sizes="(max-width: 768px) calc(100vw - 32px), 704px" className="w-full h-auto rounded-lg border" />
        </a>
        <figcaption className="text-xs text-muted-foreground">{t("workbook.imageCaption")}</figcaption>
      </figure>
      <details className="rounded-lg border bg-background group">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium flex justify-between gap-3">
          {t("workbook.tableToggle")}
          <span aria-hidden className="transition-transform group-open:rotate-180">↓</span>
        </summary>
        <div className="overflow-x-auto">
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
      </details>
      <a
        href={`${API_BASE}/v1/audit/sample-report.xlsx?lang=${locale}`}
        className="text-sm underline underline-offset-4 w-fit"
      >
        {t("workbook.sample")}
      </a>
    </section>
  );
}
