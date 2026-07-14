const siteUrl = "https://www.cleartill.money";

export default function robots() {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/blog/"],
      disallow: ["/api/", "/admin", "/account", "/dashboard"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
