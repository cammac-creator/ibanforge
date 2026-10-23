import { MetadataRoute } from "next";

/**
 * Les pages privées existent sans préfixe et sous chaque langue.
 * Sans barre finale, le refus couvre aussi la racine de la page, ses
 * paramètres et ses sous-pages. Les routes Next /api restent hors index.
 * Ces consignes aux robots ne remplacent jamais l'authentification.
 */
const PRIVATE_PATHS = [
  ...["", "/en", "/fr", "/de"].flatMap((locale) => [
    `${locale}/dashboard`,
    `${locale}/account`,
  ]),
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

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      ...SHUT_OUT.map((userAgent) => ({ userAgent, disallow: "/" })),
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
      ...WELCOMED.map((userAgent) => ({ userAgent, allow: "/", disallow: PRIVATE_PATHS })),
    ],
    sitemap: "https://ibanforge.com/sitemap.xml",
  };
}
