import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/dashboard/", "/api/auth/"] },
      { userAgent: "GPTBot", allow: "/" },
      { userAgent: "ClaudeBot", allow: "/" },
      { userAgent: "ChatGPT-User", allow: "/" },
    ],
    sitemap: "https://ibanforge.vercel.app/sitemap.xml",
  };
}
