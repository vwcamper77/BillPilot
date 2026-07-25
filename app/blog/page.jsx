import Link from "next/link";
import Logo from "@/components/Logo";
import BlogExplorer from "./BlogExplorer";
import { BLOG_CATEGORIES, BLOG_POSTS, JOURNAL_TOOLS, formatPostDate, getCategory } from "./posts";
import { createPageMetadata, SITE_URL } from "@/lib/seo";
import { createGmbfOrganizationSchema } from "@/lib/productFamily";

const PAGE_TITLE = "Journal — Practical Guides to Everyday Money";
const PAGE_DESCRIPTION = "Clear, practical guides to managing bills, planning around payday, everyday spending and saving — without jargon or judgement.";

const pageMetadata = createPageMetadata({
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  path: "/blog",
});

export const metadata = {
  ...pageMetadata,
  alternates: {
    ...pageMetadata.alternates,
    types: { "application/rss+xml": `${SITE_URL}/blog/feed.xml` },
  },
};

export default async function BlogPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const requestedTopic = typeof resolvedSearchParams?.topic === "string" ? resolvedSearchParams.topic : "all";
  const activeCategory = BLOG_CATEGORIES.some((category) => category.slug === requestedTopic) ? requestedTopic : "all";
  const categoryPosts = activeCategory === "all"
    ? BLOG_POSTS
    : BLOG_POSTS.filter((post) => post.category === activeCategory);
  const posts = categoryPosts.map((post) => ({
    ...post,
    content: undefined,
    categoryLabel: getCategory(post.category)?.label || post.category,
    formattedDate: formatPostDate(post.publishedAt),
  }));

  const collectionSchema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "The ClearTill Journal",
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/blog`,
    isPartOf: { "@type": "WebSite", name: "ClearTill", url: SITE_URL },
    publisher: createGmbfOrganizationSchema(),
    mainEntity: {
      "@type": "ItemList",
      itemListElement: [...JOURNAL_TOOLS, ...categoryPosts].map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: item.type === "tool" ? `${SITE_URL}${item.href}` : `${SITE_URL}/blog/${item.slug}`,
        name: item.title,
      })),
    },
  };

  return (
    <main className="blog-shell">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionSchema).replace(/</g, "\\u003c") }} />

      <header className="blog-header">
        <Link className="blog-logo" href="/" aria-label="ClearTill home"><Logo height={38} /></Link>
        <nav className="blog-nav" aria-label="Main navigation">
          <Link href="/">Home</Link>
          <Link className="is-active" href="/blog" aria-current="page">Journal</Link>
          <Link className="blog-nav-cta" href="/start">Try ClearTill</Link>
        </nav>
      </header>

      <section className="blog-hero">
        <div className="blog-hero-copy">
          <p className="eyebrow">The ClearTill Journal</p>
          <h1>Money, made a little clearer.</h1>
          <p className="blog-hero-lede">
            Useful, plain-English guides to bills, payday and everyday spending—written for real life, not a perfect spreadsheet.
          </p>
          <div className="blog-principles" aria-label="Our editorial principles">
            <span>Plain English</span>
            <span>Practical steps</span>
            <span>No judgement</span>
          </div>
        </div>
        <div className="blog-hero-visual" aria-hidden="true">
          <div className="blog-note blog-note-one"><i />Bills due<br /><strong>before payday</strong><span>See what&apos;s spoken for</span></div>
          <div className="blog-note blog-note-two"><i />Everyday money<br /><strong>without the jargon</strong><span>Read in a few minutes</span></div>
          <div className="blog-pencil" />
        </div>
      </section>

      <section className="blog-topics" aria-labelledby="browse-topics">
        <div className="blog-section-intro">
          <p className="eyebrow">Start where you are</p>
          <h2 id="browse-topics">Browse by topic</h2>
        </div>
        <div className="blog-topic-grid">
          {BLOG_CATEGORIES.map((category, index) => (
            <Link
              href={`/blog?topic=${category.slug}#latest-guides`}
              className={`blog-topic blog-topic-${index + 1}`}
              aria-current={activeCategory === category.slug ? "page" : undefined}
              key={category.slug}
            >
              <span className="blog-topic-number">0{index + 1}</span>
              <h3>{category.label}</h3>
              <p>{category.description}</p>
              <span className="blog-topic-arrow" aria-hidden="true">↗</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="blog-tools" id="free-tools" aria-labelledby="free-tools-title">
        <div className="blog-section-intro">
          <p className="eyebrow">Free tools</p>
          <h2 id="free-tools-title">Put the method to work</h2>
        </div>
        {JOURNAL_TOOLS.map((tool) => (
          <article className="blog-tool-card" key={tool.slug}>
            <div className="blog-tool-mark" aria-hidden="true"><span>£</span><i /></div>
            <div>
              <span className="blog-tool-label">{tool.label}</span>
              <h3>{tool.title}</h3>
              <p>{tool.description}</p>
            </div>
            <Link href={tool.href} aria-label={`Open ${tool.title}`}>Use calculator <span aria-hidden="true">→</span></Link>
          </article>
        ))}
      </section>

      <BlogExplorer posts={posts} categories={BLOG_CATEGORIES} activeCategory={activeCategory} />

      <aside className="blog-editorial-note" id="journal-note">
        <div>
          <p className="eyebrow">A note from ClearTill</p>
          <h2>Clarity beats complexity.</h2>
        </div>
        <p>
          Personal finance content can make ordinary money decisions feel harder than they are. Our journal focuses on one useful idea at a time, with examples you can actually use. It offers general information, not personalised financial advice.
        </p>
      </aside>

      <section className="blog-cta">
        <div>
          <p className="eyebrow">Put the guides into practice</p>
          <h2>See what&apos;s actually clear to spend before you&apos;re paid.</h2>
        </div>
        <div className="blog-cta-actions">
          <Link className="primary-button" href="/start">Start my no-card preview</Link>
          <span>No bank login required</span>
        </div>
      </section>
    </main>
  );
}
