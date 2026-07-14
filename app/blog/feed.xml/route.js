import { BLOG_POSTS, getCategory } from "../posts";

const SITE_URL = "https://www.cleartill.money";

function escapeXml(value = "") {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function GET() {
  const items = BLOG_POSTS.map((post) => {
    const url = `${SITE_URL}/blog/${post.slug}`;
    return `
      <item>
        <title>${escapeXml(post.title)}</title>
        <link>${url}</link>
        <guid isPermaLink="true">${url}</guid>
        <description>${escapeXml(post.description)}</description>
        <category>${escapeXml(getCategory(post.category)?.label || post.category)}</category>
        <pubDate>${new Date(`${post.publishedAt}T12:00:00Z`).toUTCString()}</pubDate>
      </item>`;
  }).join("");

  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
    <rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
      <channel>
        <title>The ClearTill Journal</title>
        <link>${SITE_URL}/blog</link>
        <description>Clear, practical guides to bills, payday, everyday spending and saving.</description>
        <language>en-gb</language>
        <atom:link href="${SITE_URL}/blog/feed.xml" rel="self" type="application/rss+xml" />
        ${items}
      </channel>
    </rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
