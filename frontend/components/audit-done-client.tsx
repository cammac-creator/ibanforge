"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Download, Loader2, Printer } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { AuditSummaryView, type AuditStatus } from "@/components/audit-summary";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://api.ibanforge.com";

export function AuditDoneClient({ locale }: { locale: string }) {
  const t = useTranslations("audit");
  const [status, setStatus] = useState<AuditStatus | null>(null);
  const [state, setState] = useState<"polling" | "paid" | "unpaid" | "missing">("polling");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const job = params.get("job");
    const session = params.get("session_id");
    if (!job) {
      setState("missing");
      return;
    }
    let attempts = 0;
    let stopped = false;
    const tick = async () => {
      attempts++;
      try {
        const r = await fetch(
          `${API_BASE}/v1/audit/status/${encodeURIComponent(job)}?session_id=${encodeURIComponent(session ?? "")}`,
        );
        if (r.status === 404) {
          setState("missing");
          return;
        }
        const body = (await r.json()) as AuditStatus;
        setStatus(body);
        if (body.paid && body.download) {
          setState("paid");
          return;
        }
      } catch {
        // keep polling
      }
      if (!stopped && attempts < 30) setTimeout(tick, 2000);
      else if (!stopped) setState("unpaid");
    };
    void tick();
    return () => {
      stopped = true;
    };
  }, []);

  if (state === "missing") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t("done.missingTitle")}</h1>
        <p className="text-muted-foreground">{t("done.missing")}</p>
        <Link href={`/${locale}/audit`} className="underline">
          {t("done.back")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          {state === "paid" ? t("done.title") : t("done.waitingTitle")}
        </h1>
        {state === "polling" ? (
          <p className="text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("done.waiting")}
          </p>
        ) : null}
        {state === "unpaid" ? <p className="text-muted-foreground">{t("done.notPaid")}</p> : null}
        {state === "paid" ? <p className="text-muted-foreground">{t("done.paid")}</p> : null}
      </header>

      {state === "paid" && status?.download ? (
        <div className="flex flex-wrap gap-3 print:hidden">
          <a href={`${API_BASE}${status.download}`} className={buttonVariants()}>
            <Download className="mr-2 h-4 w-4" aria-hidden />
            {t("done.download")}
          </a>
          <Button type="button" variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" aria-hidden />
            {t("done.print")}
          </Button>
        </div>
      ) : null}

      {status ? <AuditSummaryView status={status} masked={false} /> : null}

      {state === "paid" ? (
        <p className="text-xs text-muted-foreground">{t("done.retention")}</p>
      ) : null}
      <p className="text-sm text-muted-foreground print:hidden">
        <Link href={`/${locale}/audit`} className="underline">
          {t("done.back")}
        </Link>
      </p>
    </div>
  );
}
