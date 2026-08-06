"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://api.ibanforge.com";
const COUNTRIES = ["CH", "DE", "AT", "BE"] as const;

interface TestIbanItem {
  iban: string;
  formatted: string;
  country: string;
  proof: {
    bank_code_check: {
      value: string;
      status: string;
      register: string;
      authoritative: boolean;
      as_of: string;
      institution?: { name?: string | null } | null;
    };
    bic: { code?: string | null; bank_name?: string | null } | null;
  };
  note: string;
}

export function TestIbanClient() {
  const t = useTranslations("testIban");
  const [country, setCountry] = useState<string>("CH");
  const [item, setItem] = useState<TestIbanItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(
    async (c: string) => {
      setLoading(true);
      setError(false);
      setCopied(false);
      try {
        const qs = c === "random" ? "" : `?country=${c}`;
        const r = await fetch(`${API_BASE}/v1/test-iban${qs}`);
        if (!r.ok) throw new Error(String(r.status));
        const body = (await r.json()) as { test_ibans: TestIbanItem[] };
        setItem(body.test_ibans[0] ?? null);
        if (!body.test_ibans[0]) setError(true);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void generate("CH");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copyIban() {
    if (!item) return;
    try {
      await navigator.clipboard.writeText(item.iban);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the IBAN stays selectable */
    }
  }

  const check = item?.proof.bank_code_check;
  const institution = check?.institution?.name ?? item?.proof.bic?.bank_name ?? null;

  return (
    <section className="rounded-xl border border-border bg-card p-6 flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground mr-1">{t("countryLabel")}</span>
        {COUNTRIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCountry(c)}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors",
              country === c
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {c}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCountry("random")}
          className={cn(
            "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors",
            country === "random"
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {t("random")}
        </button>
        <Button onClick={() => void generate(country)} disabled={loading} className="ml-auto">
          <RefreshCw className={cn("size-4 mr-2", loading && "animate-spin")} />
          {loading ? t("generating") : t("generate")}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{t("error")}</p>}

      {item && !error && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <code className="text-lg sm:text-xl font-mono tracking-wide select-all">{item.formatted}</code>
            <Button variant="outline" size="sm" onClick={() => void copyIban()}>
              {copied ? <Check className="size-4 mr-1.5" /> : <Copy className="size-4 mr-1.5" />}
              {copied ? t("copied") : t("copy")}
            </Button>
          </div>

          <div className="rounded-lg border border-border bg-muted/30 p-4 flex flex-col gap-2 text-sm">
            <p className="font-medium">{t("proofTitle")}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted-foreground">
              <dt>{t("statusLabel")}</dt>
              <dd>
                <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                  <Check className="size-3.5" />
                  {check?.value} — {check?.status}
                </span>
              </dd>
              <dt>{t("registerLabel")}</dt>
              <dd className="text-foreground">{check?.register}</dd>
              {institution && (
                <>
                  <dt>{t("institutionLabel")}</dt>
                  <dd className="text-foreground">{institution}</dd>
                </>
              )}
              {item.proof.bic?.code && (
                <>
                  <dt>{t("bicLabel")}</dt>
                  <dd className="text-foreground font-mono">{item.proof.bic.code}</dd>
                </>
              )}
              <dt>{t("asOfLabel")}</dt>
              <dd>{check?.as_of}</dd>
            </dl>
          </div>

          <p className="text-xs text-muted-foreground">{item.note}</p>
        </div>
      )}
    </section>
  );
}
