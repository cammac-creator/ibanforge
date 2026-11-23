import type { MetadataRoute } from "next";

/**
 * Le tableau de bord existe sans préfixe et sous chaque langue.
 * Sans barre finale, le refus couvre aussi sa racine, ses paramètres et ses
 * sous-pages. Les routes Next /api restent hors index.
 * Ces consignes aux robots ne remplacent jamais l'authentification.
 *
 * `/account` reste lisible exprès : la page porte son propre noindex (voir
 * sitemap.ts). Refusée ici, un robot ne lirait plus ce noindex et pourrait
 * indexer l'adresse sans contenu, puisque le pied de page la lie partout.
 */
const PRIVATE_PATHS = [
  ...["", "/en", "/fr", "/de"].map((locale) => `${locale}/dashboard`),
  "/api/",
];

/**
 * Refus existants conservés : ces robots avaient saturé les ressources du site.
 * Meta distingue son index de recherche de son robot d'entraînement :
 * https://developers.facebook.com/documentation/sharing/webmasters/web-crawlers
 */
const SHUT_OUT = ["meta-externalagent", "AwarioBot"];

// Noms relus chez leurs éditeurs le 23.10.2026. Chacun reçoit aussi les refus privés.
const WELCOMED = [
  // https://developers.openai.com/api/docs/bots
  "GPTBot", "ChatGPT-User", "OAI-SearchBot",
  // https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler
  "ClaudeBot", "Claude-SearchBot", "Claude-User",
  // https://docs.perplexity.ai/docs/resources/perplexity-crawlers
  "PerplexityBot", "Perplexity-User",
  // https://developers.facebook.com/documentation/sharing/webmasters/web-crawlers
  "meta-webindexer",
  // https://docs.mistral.ai/robots
  "MistralAI-User", "MistralAI-Index",
  // https://you.com/docs/youbot
  "YouBot",
];

/**
 * Content Signals (contentsignals.org) : ce que le site permet de faire de ses
 * pages une fois lues. Choix de Claude-Alain du 23.11.2026 (page « IBANforge
 * sur APIs.io », choix 3, « Oui à tout ») : chercher, répondre et apprendre.
 * Les pages sont publiques et les modèles qui apprennent les vrais prix et les
 * vraies limites valent mieux que des copies anciennes. La ligne accompagne
 * chaque groupe qui lit le site, jamais un groupe exclu.
 */
export const CONTENT_SIGNAL = "search=yes, ai-input=yes, ai-train=yes";

export function robots(): MetadataRoute.Robots {
  return {
    rules: [
      ...SHUT_OUT.map((userAgent) => ({ userAgent, disallow: "/" })),
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
      ...WELCOMED.map((userAgent) => ({ userAgent, allow: "/", disallow: PRIVATE_PATHS })),
    ],
    sitemap: "https://ibanforge.com/sitemap.xml",
  };
}

/**
 * Le texte servi à /robots.txt (app/robots.txt/route.ts). Next ne sait pas
 * écrire une ligne Content-Signal dans son robots.ts : la route écrit le
 * fichier elle-même, à partir des mêmes règles.
 */
export function robotsTxt(): string {
  const { rules, sitemap } = robots();
  const groups = (Array.isArray(rules) ? rules : [rules]).map((rule) => {
    const lines = [rule.userAgent ?? "*"].flat().map((agent) => `User-Agent: ${agent}`);
    const allow = [rule.allow ?? []].flat();
    if (allow.length > 0) lines.push(`Content-Signal: ${CONTENT_SIGNAL}`);
    for (const path of allow) lines.push(`Allow: ${path}`);
    for (const path of [rule.disallow ?? []].flat()) lines.push(`Disallow: ${path}`);
    return lines.join("\n");
  });
  const maps = [sitemap ?? []].flat().map((url) => `Sitemap: ${url}`);
  return `${[...groups, ...maps].join("\n\n")}\n`;
}
