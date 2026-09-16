"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuditSummaryView, type AuditStatus } from "@/components/audit-summary";
import { auditErrorText } from "@/lib/audit-errors";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://api.ibanforge.com";

type Stage = "idle" | "uploading" | "preview" | "paying";

export function AuditClient({ locale }: { locale: string }) {
  const t = useTranslations("audit");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<AuditStatus | null>(null);
  const [email, setEmail] = useState("");
  const [dragging, setDragging] = useState(false);
  const [demonstration, setDemonstration] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);

  // Back from a cancelled Checkout: the job is in the URL, show its preview again.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("job");
    if (!id) return;
    const request = ++requestRef.current;
    fetch(`${API_BASE}/v1/audit/status/${encodeURIComponent(id)}`)
      .then(async (r) => (r.ok ? ((await r.json()) as AuditStatus) : null))
      .then((s) => {
        if (request === requestRef.current && s && !s.paid) {
          setDemonstration(false);
          setJob(s);
          setStage("preview");
        }
      })
      .catch(() => undefined);
  }, []);

  const upload = useCallback(
    async (file: File, example = false) => {
      const request = ++requestRef.current;
      setError(null);
      setJob(null);
      setDemonstration(example);
      setStage("uploading");
      const form = new FormData();
      form.append("file", file);
      form.append("lang", locale);
      try {
        const r = await fetch(`${API_BASE}/v1/audit/upload`, { method: "POST", body: form });
        const body = (await r.json()) as AuditStatus & { error?: string; message?: string };
        if (request !== requestRef.current) return;
        if (!r.ok) {
          setError(auditErrorText(t, body.error, body.message));
          setStage("idle");
          return;
        }
        setJob(body);
        setStage("preview");
      } catch {
        if (request !== requestRef.current) return;
        setError(t("upload.error.network"));
        setStage("idle");
      }
    },
    [locale, t],
  );

  const pay = useCallback(async () => {
    if (!job || demonstration) return;
    setError(null);
    setStage("paying");
    try {
      const r = await fetch(`${API_BASE}/v1/audit/checkout/${encodeURIComponent(job.job)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale, email: email.trim() || undefined }),
      });
      const body = (await r.json()) as { url?: string; error?: string; message?: string };
      if (!r.ok || !body.url) {
        setError(auditErrorText(t, body.error, body.message));
        setStage("preview");
        return;
      }
      window.location.href = body.url;
    } catch {
      setError(t("upload.error.network"));
      setStage("preview");
    }
  }, [job, demonstration, email, locale, t]);

  return (
    <section className="flex flex-col gap-6" id="audit">
      <div
        className={`rounded-lg border-2 border-dashed p-6 flex flex-col items-center gap-3 text-center transition-colors ${dragging ? "border-amber-500 bg-amber-500/10" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f && stage !== "uploading" && stage !== "paying") void upload(f);
        }}
      >
        <Upload className="h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="font-medium">{dragging ? t("upload.dropHere") : t("upload.label")}</p>
        <p className="text-sm text-muted-foreground max-w-prose">{t("upload.hint")}</p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.txt,.tsv,.xlsx,.xls"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={() => inputRef.current?.click()} disabled={stage === "uploading" || stage === "paying"}>
            {stage === "uploading" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                {t("upload.analyzing")}
              </>
            ) : (
              t("upload.button")
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={stage === "uploading" || stage === "paying"}
            onClick={() => void upload(new File([sampleCsv()], "exemple-creanciers.csv", { type: "text/csv" }), true)}
          >
            {t("upload.sample")}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      {job && stage !== "idle" ? (
        <div className="flex flex-col gap-6 ibf-rise">
          {demonstration ? (
            <div role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5">
              <h3 className="font-semibold">{t("demo.title")}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{t("demo.description")}</p>
            </div>
          ) : null}
          <AuditSummaryView status={job} masked demonstration={demonstration} />
          {demonstration ? (
            <div className="rounded-xl border p-5 flex flex-col gap-4" data-audit-demonstration>
              <p className="text-sm text-muted-foreground">{t("demo.next")}</p>
              <div className="flex flex-wrap gap-3">
                <Button type="button" onClick={() => inputRef.current?.click()}>{t("demo.upload")}</Button>
                <a className="rounded-md border px-4 py-2 text-sm underline underline-offset-4" href={`${API_BASE}/v1/audit/sample-report.xlsx?lang=${locale}`}>
                  {t("demo.download")}
                </a>
              </div>
            </div>
          ) : (
          <div className="rounded-lg border p-5 flex flex-col gap-4">
            <h3 className="font-semibold">
              {t("pay.title", { price: job.price, rows: job.rows })}
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{t("pay.text")}</p>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{t("pay.email")}</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.ch"
                className="rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
            <Button type="button" onClick={() => void pay()} disabled={stage === "paying"} className="w-fit">
              {stage === "paying" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  {t("pay.redirecting")}
                </>
              ) : (
                t("pay.button", { price: job.price })
              )}
            </Button>
            <p className="text-xs text-muted-foreground">{t("pay.retention")}</p>
          </div>
          )}
        </div>
      ) : null}
    </section>
  );
}


/** A small, synthetic creditor file: real bank codes, invented accounts, one of each finding. */
function sampleCsv(): string {
  return [
    "Nom;IBAN;BIC;Adresse;NPA;Ville;Pays",
    "Alpha Menuiserie SA;CH10 0023 0000 0000 1234 5;;Rue du Lac 12;1003;Lausanne;CH",
    "Beta Elektro GmbH;DE89 3704 0044 0532 0130 00;COBADEFFXXX;Hauptstrasse 1;10115;Berlin;DE",
    "Gamma Transports Sàrl;CH10 0023 0000 0000 1234 6;;Case postale;;;CH",
    "Delta Consulting;CH93 0076 2011 6238 5295 7;;Chemin des Fleurs 3;1200;Geneve;CH",
    "Alpha Menuiserie SA;CH10 0023 0000 0000 1234 5;;Rue du Lac 12;1003;Lausanne;CH",
    "Epsilon Import AG;DE89 3704 0044 0532 0130 00;DEUTDEFFXXX;Ringstrasse 8;60311;Frankfurt;Suisse",
    "Zeta Boulangerie;;;Grand-Rue 4;1700;Fribourg;CH",
    "Eta Services;GB29 NWBK 6016 1331 9268 19;;10 Downing Street;SW1A 2AA;London;GB",
  ].join("\n");
}
