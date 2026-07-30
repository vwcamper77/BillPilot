import { JOURNAL_TOOLS } from "./blog/posts";
import { getPublishedJournalPosts } from "@/lib/journal/repository.server";
import { HOME_URL, SITE_URL } from "@/lib/seo";

export const dynamic = "force-dynamic";

export default async function sitemap() {
  const publishedPosts = await getPublishedJournalPosts();
  const staticPages = [
    {
      url: HOME_URL,
      lastModified: "2026-07-18",
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/pricing`,
      lastModified: "2026-07-17",
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/about-cleartill`,
      lastModified: "2026-07-18",
      changeFrequency: "yearly",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/free-cash-position-sheet`,
      lastModified: "2026-07-18",
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/blog`,
      lastModified: "2026-07-18",
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/security`,
      lastModified: "2026-07-12",
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified: "2026-07-18",
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified: "2026-07-01",
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  const blogPosts = publishedPosts.map((post) => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: post.updatedAt || post.publishedAt,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  const tools = JOURNAL_TOOLS.map((tool) => ({
    url: `${SITE_URL}${tool.href}`,
    lastModified: tool.lastModified,
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  return [...staticPages, ...tools, ...blogPosts];
}
