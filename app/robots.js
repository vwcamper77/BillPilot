import { SITE_URL } from "@/lib/seo";

export default function robots() {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/about-cleartill", "/pricing", "/security", "/privacy", "/terms", "/blog/"],
      disallow: ["/api/", "/admin/", "/account/", "/dashboard/", "/access/", "/billing/", "/trial/", "/signin", "/start", "/unsubscribe"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
