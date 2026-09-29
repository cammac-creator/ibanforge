import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { GetKeyButton } from "@/components/api-key-dialog";
import { localePath } from "@/lib/locale-path";
import { REGISTER_CTA_DOCS_PATH, REGISTER_CTA_EVENT, trialCurl } from "@/lib/register-cta";

/**
 * "Get this answer from your own software", placed right after the API's answer
 * on the publishable bank-code pages. Why, and what it may say: lib/register-cta.ts.
 *
 * A server component: the text is rendered once on the server, and only the
 * button that opens the existing key dialog is a client island.
 */
export async function RegisterApiCta({ locale, exampleIban }: { locale: string; exampleIban: string }) {
  const t = await getTranslations({ locale, namespace: "registerCta" });
  return (
    <section
      aria-labelledby="register-cta-title"
      data-register-cta=""
      className="flex flex-col gap-4 rounded-md border px-4 py-4 sm:px-5"
      style={{ borderColor: "var(--hairline)" }}
    >
      <div className="flex flex-col gap-1.5">
        <h2 id="register-cta-title" className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("lead")}</p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("trialTitle")}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("trialText")}</p>
        <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto"><code>{trialCurl(exampleIban)}</code></pre>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("keyTitle")}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("keyText")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <GetKeyButton variant="amber" size="sm" className="w-fit" evt={REGISTER_CTA_EVENT}>
          {t("keyButton")}
        </GetKeyButton>
        <Link
          href={localePath(locale, REGISTER_CTA_DOCS_PATH)}
          className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
        >
          {t("docsLink")}
        </Link>
      </div>
    </section>
  );
}
