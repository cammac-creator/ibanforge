"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://api.ibanforge.com";

const SAMPLE_S = [
  "SPC", "0200", "1", "CH4431999123000889012",
  "S", "Robert Schneider AG", "Rue du Lac", "1268", "2501", "Biel", "CH",
  "", "", "", "", "", "", "",
  "1949.75", "CHF",
  "S", "Pia-Maria Rutschmann-Schnyder", "Grosse Marktgasse", "28", "9400", "Rorschach", "CH",
  "QRR", "210000000003139471430009017", "Order of 15 June 2026", "EPD",
].join("\n");

const SAMPLE_K = SAMPLE_S.replace(
  "S\nRobert Schneider AG\nRue du Lac\n1268\n2501\nBiel\nCH",
  "K\nRobert Schneider AG\nRue du Lac 1268\n2501 Biel\n\n\nCH",
);

interface Finding {
  code: string;
  severity: "error" | "warning";
  field: string;
  detail: string;
  source: string;
}
interface Party {
  present: boolean;
  structured: boolean | null;
  address: { type: string; name: string };
  proposed_structured: null | { strt_nm?: string; bldg_nb?: string; pst_cd?: string; twn_nm?: string; ctry?: string; confidence: string; note: string };
}
interface Result {
  valid: boolean;
  ready_for_2026_11_14: boolean;
  creditor_iban: { value: string; valid: boolean; qr_iban: boolean; iid: string | null };
  creditor: Party;
  ultimate_debtor: Party;
  amount: string | null;
  currency: string | null;
  reference: { type: string; value: string; valid: boolean | null };
  findings: Finding[];
  next_steps: string[];
  error?: string;
  message?: string;
}

export function QrBillClient() {
  const t = useTranslations("qrBill");
  const [payload, setPayload] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function check(text: string) {
    setError(null);
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/v1/ch/qr-bill/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: text }),
      });
      const body = (await r.json()) as Result;
      if (!r.ok) {
        setError(body.message ?? t("errors.generic"));
        setResult(null);
      } else {
        setResult(body);
      }
    } catch {
      setError(t("errors.network"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <label className="flex flex-col gap-2">
        <span className="font-medium">{t("input.label")}</span>
        <textarea
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          rows={12}
          spellCheck={false}
          placeholder={"SPC\n0200\n1\nCH44 3199 9123 0008 8901 2\nS\n..."}
          className="rounded-md border bg-background px-3 py-2 font-mono text-sm"
        />
        <span className="text-xs text-muted-foreground">{t("input.hint")}</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void check(payload)} disabled={busy || !payload.trim()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
          {t("input.button")}
        </Button>
        <Button type="button" variant="outline" onClick={() => { setPayload(SAMPLE_S); void check(SAMPLE_S); }} disabled={busy}>
          {t("input.sampleS")}
        </Button>
        <Button type="button" variant="outline" onClick={() => { setPayload(SAMPLE_K); void check(SAMPLE_K); }} disabled={busy}>
          {t("input.sampleK")}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Verdict ok={result.valid} label={t("result.valid")} yes={t("result.yes")} no={t("result.no")} />
            <Verdict ok={result.ready_for_2026_11_14} label={t("result.ready")} yes={t("result.yes")} no={t("result.no")} />
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Fact label={t("result.iban")} value={`${result.creditor_iban.valid ? "OK" : "KO"}${result.creditor_iban.qr_iban ? " · QR-IBAN" : ""}`} />
            <Fact label={t("result.reference")} value={`${result.reference.type}${result.reference.valid === null ? "" : result.reference.valid ? " · OK" : " · KO"}`} />
            <Fact label={t("result.creditorAddress")} value={addressWord(t, result.creditor)} />
            <Fact label={t("result.debtorAddress")} value={result.ultimate_debtor.present ? addressWord(t, result.ultimate_debtor) : "–"} />
          </dl>

          {result.findings.length > 0 ? (
            <div className="rounded-lg border p-4 flex flex-col gap-2">
              <h3 className="font-semibold">{t("result.findings")}</h3>
              <ul className="flex flex-col gap-2 text-sm">
                {result.findings.map((f, i) => (
                  <li key={`${f.code}-${i}`} className="flex flex-col gap-0.5">
                    <span className={f.severity === "error" ? "font-medium text-red-700 dark:text-red-400" : "font-medium text-amber-700 dark:text-amber-400"}>
                      {f.severity === "error" ? t("result.error") : t("result.warning")} · <code className="font-mono text-xs">{f.field}</code>
                    </span>
                    <span>{f.detail}</span>
                    <span className="text-xs text-muted-foreground">{f.source}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("result.clean")}</p>
          )}

          {[result.creditor, result.ultimate_debtor].map((p, i) =>
            p.proposed_structured ? (
              <div key={i} className="rounded-lg border border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20 p-4 flex flex-col gap-2 text-sm">
                <h3 className="font-semibold">{i === 0 ? t("result.proposedCreditor") : t("result.proposedDebtor")}</h3>
                <pre className="font-mono text-xs overflow-x-auto">{JSON.stringify(
                  { adr_tp: "S", strt_nm: p.proposed_structured.strt_nm, bldg_nb: p.proposed_structured.bldg_nb, pst_cd: p.proposed_structured.pst_cd, twn_nm: p.proposed_structured.twn_nm, ctry: p.proposed_structured.ctry },
                  null,
                  2,
                )}</pre>
                <p className="text-muted-foreground">{p.proposed_structured.note}</p>
              </div>
            ) : null,
          )}

          {result.next_steps.length > 0 ? (
            <div className="text-sm">
              <h3 className="font-semibold mb-1">{t("result.nextSteps")}</h3>
              <ol className="list-decimal pl-5 flex flex-col gap-1 text-muted-foreground">
                {result.next_steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function addressWord(t: ReturnType<typeof useTranslations>, p: Party): string {
  if (!p.present) return "–";
  if (p.structured === true) return t("result.structured");
  if (p.structured === false) return t("result.combined");
  return t("result.invalidType");
}

function Verdict({ ok, label, yes, no }: { ok: boolean; label: string; yes: string; no: string }) {
  return (
    <div className={`rounded-lg border p-4 ${ok ? "border-emerald-300/60 bg-emerald-50/60 dark:bg-emerald-950/20" : "border-red-300/60 bg-red-50/60 dark:bg-red-950/20"}`}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold ${ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>{ok ? yes : no}</p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
