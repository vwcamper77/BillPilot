import Link from "next/link";
import Logo from "@/components/Logo";
import BlogExplorer from "./BlogExplorer";
import { BLOG_CATEGORIES, BLOG_POSTS, formatPostDate, getCategory } from "./posts";

const SITE_URL = "https://www.cleartill.money";
const PAGE_TITLE = "The ClearTill Journal | Practical guides to everyday money";
const PAGE_DESCRIPTION = "Clear, practical guides to managing bills, planning around payday, everyday spending and saving — without jargon or judgement.";

export const metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: {
    canonical: "/blog",
    types: { "application/rss+xml": `${SITE_URL}/blog/feed.xml` },
  },
  openGraph: {
    type: "website",
    siteName: "ClearTill",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/blog`,
    images: [{ url: "/social/cleartill-og-v2.png", width: 1200, height: 630, alt: "ClearTill" }],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: ["/social/cleartill-og-v2.png"],
  },
};

export default function BlogPage() {
  const posts = BLOG_POSTS.map((post) => ({
    ...post,
    content: undefined,
    categoryLabel: getCategory(post.category)?.label || post.category,
    formattedDate: formatPostDate(post.publishedAt),
  }));

  const collectionSchema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/blog`,
    isPartOf: { "@type": "WebSite", name: "ClearTill", url: SITE_URL },
    publisher: { "@type": "Organization", name: "ClearTill", url: SITE_URL },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: BLOG_POSTS.map((post, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${SITE_URL}/blog/${post.slug}`,
        name: post.title,
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
            <a href={BLOG_POSTS.length ? `#latest-guides` : "#journal-note"} className={`blog-topic blog-topic-${index + 1}`} key={category.slug}>
              <span className="blog-topic-number">0{index + 1}</span>
              <h3>{category.label}</h3>
              <p>{category.description}</p>
              <span className="blog-topic-arrow" aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      </section>

      <BlogExplorer posts={posts} categories={BLOG_CATEGORIES} />

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
