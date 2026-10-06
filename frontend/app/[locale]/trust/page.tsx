import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  Activity,
  ArrowUpRight,
  Ban,
  Building2,
  Database,
  FileText,
  Globe,
  LifeBuoy,
  ScrollText,
  Server,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { alternatesFor } from "@/lib/seo";
import { localePath } from "@/lib/locale-path";
import { OPERATOR_ADDRESS_LINES, TRUST_LINKS, TRUST_PROCESSORS } from "@/lib/trust";

/**
 * Security and trust (2026-10-06). One page that answers what an EU buyer's
 * data-protection review asks first: who runs the service, where it runs, what
 * is kept and for how long, who the sub-processors are and on what basis data
 * leaves Switzerland and the EU, how it is secured, how available it is, and
 * what it does not have.
 *
 * Every sentence is a summary of a contractual text or a fact checkable from
 * outside, and says so with a link. Nothing here may run ahead of the
 * documents: the register entries and the address come from lib/trust.ts,
 * which lib/trust.test.ts keeps in step with the DPA and the Legal Notice.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal.trust" });
  return {
    title: t("meta.title"),
    description: t("meta.description"),
    alternates: alternatesFor(locale, "/trust"),
  };
}

const GLANCE = ["operator", "region", "ibans", "notice"] as const;
const RETENTION_ROWS = ["0", "1", "2", "3", "4", "5"] as const;
const NOT_HAVE = ["0", "1", "2"] as const;

/** The checks a reader can run from outside, one per hosting line. */
const HOSTING = [
  { key: "api", icon: Server, check: "curl -sI https://api.ibanforge.com/health | grep -i x-railway-edge" },
  { key: "site", icon: Globe, check: "curl -sI https://ibanforge.com/ | grep -i x-vercel-id" },
  { key: "mail", icon: Building2, check: "dig +short NS ibanforge.com" },
] as const;

const linkClass =
  "inline-flex items-center gap-1 text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4 transition-colors";

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {children}
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
    </a>
  );
}

function SectionTitle({ icon: Icon, id, children }: { icon: LucideIcon; id: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 mb-1.5">
      <Icon className="h-5 w-5 shrink-0 translate-y-0.5 text-amber-500" aria-hidden />
      <h2 id={id} className="text-xl font-semibold tracking-tight">
        {children}
      </h2>
    </div>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border p-5 ${className}`} style={{ background: "var(--ink-1)" }}>
      {children}
    </div>
  );
}

export default async function TrustPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal.trust" });

  const processorLink = (dpf: string | null, basis: string | null) =>
    dpf ? (
      <ExternalLink href={dpf}>{t("processors.registerLink")}</ExternalLink>
    ) : basis ? (
      <ExternalLink href={basis}>{t("processors.documentLink")}</ExternalLink>
    ) : null;

  const DOCUMENTS = [
    { href: localePath(locale, "/legal/dpa"), label: t("documents.dpa") },
    { href: localePath(locale, "/legal/privacy"), label: t("documents.privacy") },
    { href: localePath(locale, "/legal/terms"), label: t("documents.terms") },
    { href: localePath(locale, "/legal/sla"), label: t("documents.sla") },
    { href: localePath(locale, "/legal/imprint"), label: t("documents.imprint") },
    { href: localePath(locale, "/status"), label: t("documents.status") },
    { href: localePath(locale, "/sources"), label: t("documents.sources") },
  ];

  return (
    <div className="flex flex-col">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="flex flex-col items-center text-center px-4 pt-24 pb-12 sm:pt-28 gap-6 max-w-3xl mx-auto">
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1
          className="text-4xl sm:text-5xl font-bold tracking-tight font-mono"
          style={{ lineHeight: 1.1, letterSpacing: "-0.03em" }}
        >
          {t("hero.title")}
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground" style={{ lineHeight: 1.65 }}>
          {t("hero.description")}
        </p>
        <p className="text-xs font-mono text-muted-foreground">{t("checked")}</p>
      </section>

      {/* ── At a glance ───────────────────────────────────────────────────── */}
      <section className="px-4 pb-16 max-w-5xl mx-auto w-full">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {GLANCE.map((key) => (
            <div key={key} className="rounded-xl border border-border p-4" style={{ background: "var(--ink-1)" }}>
              <dt className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                {t(`glance.${key}.label`)}
              </dt>
              <dd className="mt-1.5 text-sm font-medium text-foreground leading-snug">{t(`glance.${key}.value`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── Who runs it ───────────────────────────────────────────────────── */}
      <section className="px-4 pb-16 max-w-5xl mx-auto w-full" aria-labelledby="trust-operator">
        <SectionTitle icon={Building2} id="trust-operator">
          {t("operator.title")}
        </SectionTitle>
        <Card className="mt-4">
          <p className="text-sm text-foreground leading-relaxed">{t("operator.lead")}</p>
          <address className="mt-3 not-italic text-sm font-mono text-muted-foreground leading-relaxed">
            IBANforge
            <br />
            Claude-Alain Martin
            {OPERATOR_ADDRESS_LINES.map((line) => (
              <span key={line}>
                <br />
                {line}
              </span>
            ))}
            <br />
            {t("operator.country")}
          </address>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground leading-relaxed">
            <li>{t("operator.register")}</li>
            <li>{t("operator.vat")}</li>
            <li>{t("operator.people")}</li>
            <li>{t("operator.contact")}</li>
          </ul>
          <Link href={localePath(locale, "/legal/imprint")} className={`${linkClass} mt-4`}>
            {t("operator.link")}
          </Link>
        </Card>
      </section>

      {/* ── Where it runs ─────────────────────────────────────────────────── */}
      <section className="px-4 pb-16 max-w-5xl mx-auto w-full" aria-labelledby="trust-hosting">
        <SectionTitle icon={Server} id="trust-hosting">
          {t("hosting.title")}
        </SectionTitle>
        <p className="text-sm text-muted-foreground mb-5">{t("hosting.sub")}</p>
        <div className="grid gap-4 md:grid-cols-3">
          {HOSTING.map(({ key, icon: Icon, check }) => (
            <Card key={key} className="flex flex-col gap-2 min-w-0">
              <Icon className="h-5 w-5 text-amber-500" aria-hidden />
              <p className="text-sm font-medium text-foreground">{t(`hosting.${key}.name`)}</p>
              <p className="text-sm text-muted-foreground leading-relaxed flex-1">{t(`hosting.${key}.body`)}</p>
              <p className="mt-1 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                {t("hosting.checkLabel")}
              </p>
              <code className="block rounded-md border border-border px-2.5 py-2 text-[11.5px] font-mono text-foreground/90 break-all">
                {check}
              </code>
              <p className="text-xs text-muted-foreground leading-relaxed">{t(`hosting.${key}.checkNote`)}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* ── What we keep ──────────────────────────────────────────────────── */}
      <section className="px-4 pb-16 max-w-5xl mx-auto w-full" aria-labelledby="trust-retention">
        <SectionTitle icon={Database} id="trust-retention">
          {t("retention.title")}
        </SectionTitle>
        <div className="mt-4 rounded-xl border border-border overflow-hidden" style={{ background: "var(--ink-1)" }}>
          <div className="hidden sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 px-5 py-2.5 border-b border-border text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            <span>{t("retention.colWhat")}</span>
            <span>{t("retention.colKeep")}</span>
          </div>
          <dl>
            {RETENTION_ROWS.map((i) => (
              <div
                key={i}
                className="grid gap-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4 px-5 py-3.5 border-b border-border last:border-b-0"
              >
                <dt className="text-sm font-medium text-foreground leading-relaxed">{t(`retention.rows.${i}.what`)}</dt>
                <dd className="text-sm text-muted-foreground leading-relaxed">{t(`retention.rows.${i}.keep`)}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
          <p className="text-sm font-medium text-foreground">{t("retention.post.title")}</p>
          <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{t("retention.post.body")}</p>
        </div>
        <Link href={localePath(locale, "/legal/privacy")} className={`${linkClass} mt-4`}>
          {t("retention.link")}
        </Link>
      </section>

      {/* ── Sub-processors ────────────────────────────────────────────────── */}
      <section className="px-4 pb-16 max-w-5xl mx-auto w-full" aria-labelledby="trust-processors">
        <SectionTitle icon={ScrollText} id="trust-processors">
          {t("processors.title")}
        </SectionTitle>
        <p className="text-sm text-muted-foreground mb-5 leading-relaxed">{t("processors.sub")}</p>

        {/* Phones: one card per sub-processor, nothing to scroll sideways. */}
        <div className="grid gap-3 md:hidden">
          {TRUST_PROCESSORS.map(({ key, dpf, basis }) => (
            <Card key={key}>
              <p className="text-sm font-medium text-foreground">{t(`processors.rows.${key}.name`)}</p>
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{t(`processors.rows.${key}.role`)}</p>
              <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t("processors.col.region")}</dt>
                <dd className="text-foreground/90">{t(`processors.rows.${key}.region`)}</dd>
                <dt className="text-muted-foreground">{t("processors.col.ibans")}</dt>
                <dd className="text-foreground/90">{t(`processors.rows.${key}.ibans`)}</dd>
                <dt className="text-muted-foreground">{t("processors.col.basis")}</dt>
                <dd className="text-foreground/90">{t(`processors.rows.${key}.basis`)}</dd>
              </dl>
              <div className="mt-3">{processorLink(dpf, basis)}</div>
            </Card>
          ))}
        </div>

        {/* Wider screens: the table, as in Annex II of the DPA. */}
        <div className="hidden md:block overflow-x-auto rounded-xl border border-border" style={{ background: "var(--ink-1)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                <th scope="col" className="px-4 py-2.5 font-normal">{t("processors.col.name")}</th>
                <th scope="col" className="px-4 py-2.5 font-normal">{t("processors.col.role")}</th>
                <th scope="col" className="px-4 py-2.5 font-normal">{t("processors.col.region")}</th>
                <th scope="col" className="px-4 py-2.5 font-normal">{t("processors.col.ibans")}</th>
                <th scope="col" className="px-4 py-2.5 font-normal">{t("processors.col.basis")}</th>
              </tr>
            </thead>
            <tbody>
              {TRUST_PROCESSORS.map(({ key, dpf, basis }) => (
                <tr key={key} className="border-b border-border last:border-b-0 align-top">
                  <th scope="row" className="px-4 py-3 text-left font-medium text-foreground">
                    {t(`processors.rows.${key}.name`)}
                  </th>
                  <td className="px-4 py-3 text-muted-foreground leading-relaxed">{t(`processors.rows.${key}.role`)}</td>
                  <td className="px-4 py-3 text-muted-foreground leading-relaxed">{t(`processors.rows.${key}.region`)}</td>
                  <td className="px-4 py-3 text-muted-foreground leading-relaxed">{t(`processors.rows.${key}.ibans`)}</td>
                  <td className="px-4 py-3 text-muted-foreground leading-relaxed">
                    <span className="block">{t(`processors.rows.${key}.basis`)}</span>
                    <span className="mt-1.5 block">{processorLink(dpf, basis)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          {t("processors.note")}{" "}
          <Link href={localePath(locale, "/legal/dpa")} className={linkClass}>
            {t("processors.noteLink")}
          </Link>
        </p>
      </section>

      {/* ── Transfers ─────────────────────────────────────────────────────── */}
      <section className="px-4 pb-16 max-w-5xl mx-auto w-full" aria-labelledby="trust-transfers">
        <SectionTitle icon={Globe} id="trust-transfers">
          {t("transfers.title")}
        </SectionTitle>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Card className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">{t("transfers.switzerland")}</p>
            <div className="flex flex-col gap-1.5">
              <ExternalLink href={TRUST_LINKS.adequacySwitzerland}>{t("transfers.decisionLink")}</ExternalLink>
              <ExternalLink href={TRUST_LINKS.adequacyReview}>{t("transfers.reviewLink")}</ExternalLink>
            </div>
          </Card>
          <Card className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">{t("transfers.us")}</p>
            <div className="flex flex-col gap-1.5">
              <ExternalLink href={TRUST_LINKS.dpfEuUs}>{t("transfers.dpfLink")}</ExternalLink>
              <ExternalLink href={TRUST_LINKS.dpfList}>{t("transfers.listLink")}</ExternalLink>
            </div>
          </Card>
        </div>
      </section>

      {/* ── Security ──────────────────────────────────────────────────────── */}
      <section className="px-4 pb-16 max-w-5xl mx-auto w-full" aria-labelledby="trust-security">
        <SectionTitle icon={ShieldCheck} id="trust-security">
          {t("security.title")}
        </SectionTitle>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Card className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">{t("security.tests")}</p>
            <ExternalLink href={TRUST_LINKS.ci}>{t("security.testsLink")}</ExternalLink>
          </Card>
          <Card className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">{t("security.code")}</p>
            <ExternalLink href={TRUST_LINKS.repo}>{t("security.codeLink")}</ExternalLink>
          </Card>
          <Card>
            <p className="text-sm text-muted-foreground leading-relaxed">{t("security.keys")}</p>
          </Card>
          <Card>
            <p className="text-sm text-muted-foreground leading-relaxed">{t("security.tls")}</p>
          </Card>
          <Card className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">{t("security.report")}</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              <ExternalLink href={TRUST_LINKS.securityTxtSite}>{t("security.reportTxt")}</ExternalLink>
              <ExternalLink href={TRUST_LINKS.securityPolicy}>{t("security.reportPolicy")}</ExternalLink>
            </div>
          </Card>
          <Card>
            <p className="text-sm text-muted-foreground leading-relaxed">{t("security.deps")}</p>
          </Card>
        </div>
      </section>

      {/* ── Availability ──────────────────────────────────────────────────── */}
      <section className="px-4 pb-16 max-w-5xl mx-auto w-full" aria-labelledby="trust-availability">
        <SectionTitle icon={Activity} id="trust-availability">
          {t("availability.title")}
        </SectionTitle>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Card className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">{t("availability.status")}</p>
            <Link href={localePath(locale, "/status")} className={linkClass}>
              {t("availability.statusLink")}
            </Link>
          </Card>
          <Card className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">{t("availability.sla")}</p>
            <Link href={localePath(locale, "/legal/sla")} className={linkClass}>
              {t("availability.slaLink")}
            </Link>
          </Card>
          <Card>
            <p className="text-sm text-muted-foreground leading-relaxed">{t("availability.probe")}</p>
          </Card>
        </div>
        <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/5 p-5 flex flex-col gap-3">
          <p className="text-sm text-foreground/90 leading-relaxed">{t("availability.instance")}</p>
          <ExternalLink href={TRUST_LINKS.railwayVolumes}>{t("availability.instanceLink")}</ExternalLink>
        </div>
      </section>

      {/* ── Data ──────────────────────────────────────────────────────────── */}
      <section className="px-4 pb-16 max-w-5xl mx-auto w-full" aria-labelledby="trust-data">
        <SectionTitle icon={FileText} id="trust-data">
          {t("data.title")}
        </SectionTitle>
        <Card className="mt-4">
          <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
            <p>{t("data.registers")}</p>
            <p>{t("data.permissions")}</p>
            <p>{t("data.frozen")}</p>
          </div>
          <div className="mt-4 flex flex-col sm:flex-row gap-x-6 gap-y-1.5">
            <Link href={localePath(locale, "/sources")} className={linkClass}>
              {t("data.sourcesLink")}
            </Link>
            <Link href={localePath(locale, "/docs/data-sources")} className={linkClass}>
              {t("data.docsLink")}
            </Link>
          </div>
        </Card>
      </section>

      {/* ── Continuity ────────────────────────────────────────────────────── */}
      <section className="px-4 pb-16 max-w-5xl mx-auto w-full" aria-labelledby="trust-continuity">
        <SectionTitle icon={LifeBuoy} id="trust-continuity">
          {t("continuity.title")}
        </SectionTitle>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Card className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">{t("continuity.notice")}</p>
            <Link href={localePath(locale, "/legal/terms")} className={linkClass}>
              {t("continuity.noticeLink")}
            </Link>
          </Card>
          <Card className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">{t("continuity.code")}</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              <ExternalLink href={TRUST_LINKS.repo}>{t("continuity.codeRepo")}</ExternalLink>
              <ExternalLink href={TRUST_LINKS.corePackage}>{t("continuity.codeNpm")}</ExternalLink>
            </div>
          </Card>
          <Card className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">{t("continuity.selfhost")}</p>
            <ExternalLink href={TRUST_LINKS.notice}>{t("continuity.selfhostLink")}</ExternalLink>
          </Card>
        </div>
      </section>

      {/* ── What we do not have ───────────────────────────────────────────── */}
      <section className="px-4 pb-16 max-w-5xl mx-auto w-full" aria-labelledby="trust-not-have">
        <div className="rounded-xl border border-border p-6" style={{ background: "var(--ink-1)" }}>
          <div className="flex items-baseline gap-3 mb-3">
            <Ban className="h-5 w-5 shrink-0 translate-y-0.5 text-amber-500" aria-hidden />
            <h2 id="trust-not-have" className="text-lg font-semibold tracking-tight">
              {t("notHave.title")}
            </h2>
          </div>
          <ul className="space-y-2 text-sm text-muted-foreground leading-relaxed list-disc pl-5 marker:text-amber-500">
            {NOT_HAVE.map((i) => (
              <li key={i}>{t(`notHave.items.${i}`)}</li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-foreground/90 leading-relaxed">{t("notHave.body")}</p>
        </div>
      </section>

      {/* ── Documents ─────────────────────────────────────────────────────── */}
      <section className="px-4 pb-20 max-w-5xl mx-auto w-full" aria-labelledby="trust-documents">
        <SectionTitle icon={ScrollText} id="trust-documents">
          {t("documents.title")}
        </SectionTitle>
        <div className="mt-4 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {DOCUMENTS.map((doc) => (
            <Link
              key={doc.href}
              href={doc.href}
              className="group rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              {doc.label}
            </Link>
          ))}
          <a
            href={TRUST_LINKS.securityTxtApi}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground transition-colors hover:border-primary/40 hover:text-primary"
          >
            {t("documents.securityTxt")}
          </a>
          <a
            href={TRUST_LINKS.securityPolicy}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground transition-colors hover:border-primary/40 hover:text-primary"
          >
            {t("documents.securityPolicy")}
          </a>
        </div>
        <p className="mt-4 text-sm text-muted-foreground leading-relaxed">{t("documents.dpaNote")}</p>
      </section>
    </div>
  );
}
