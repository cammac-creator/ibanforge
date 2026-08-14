import { MDXRemote } from "next-mdx-remote/rsc";
import { mdxOptions, mdxComponents } from "@/lib/mdx";
import { getTranslations } from "next-intl/server";

export const revalidate = 3600;

/**
 * Pinned to the deployed commit, not to `main`.
 *
 * Next's data cache is keyed by URL and survives redeployment on Vercel, so a
 * fetch of the `main` URL keeps serving whatever it cached for up to an hour
 * regardless of what has been pushed or redeployed since. When a bad line went
 * in, that cached copy took the page down in every locale and neither the fix
 * nor a fresh deployment cleared it: production kept compiling the broken text.
 *
 * The commit SHA changes the URL on every deployment, which retires the old
 * entry by construction. It also makes the page show the changelog of the build
 * you are actually looking at. Falls back to `main` for local development,
 * where the variable is unset.
 */
const REF = process.env.VERCEL_GIT_COMMIT_SHA || "main";
const CHANGELOG_URL = `https://raw.githubusercontent.com/cammac-creator/ibanforge/${REF}/CHANGELOG.md`;

async function getChangelog(): Promise<string | null> {
  try {
    const res = await fetch(CHANGELOG_URL, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "changelog" });
  return { title: `${t("title")} | IBANforge`, description: t("subtitle") };
}

export default async function ChangelogPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("changelog");
  const markdown = await getChangelog();

  return (
    <article className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-14">
      <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("subtitle")}</p>

      <div className="mt-6 rounded-lg border border-border bg-card p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("policyTitle")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{t("policyBody")}</p>
      </div>

      <div className="mt-10 prose prose-invert prose-amber max-w-none prose-headings:font-heading prose-headings:tracking-tight prose-h1:hidden prose-h2:text-xl prose-h2:mt-10 prose-h2:mb-4 prose-h3:text-base prose-p:text-muted-foreground prose-p:leading-relaxed prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-code:text-primary prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none prose-strong:text-foreground prose-li:text-muted-foreground">
        {markdown ? (
          <MDXRemote source={markdown} options={mdxOptions} components={mdxComponents} />
        ) : (
          <p>
            {t("fallback")}{" "}
            <a href="https://github.com/cammac-creator/ibanforge/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">
              GitHub → CHANGELOG.md
            </a>
          </p>
        )}
      </div>
      <p className="mt-6 text-xs text-muted-foreground">
        {locale !== "en" ? t("englishOnly") : ""}
      </p>
    </article>
  );
}
