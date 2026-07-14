import Link from "next/link";
import { notFound } from "next/navigation";
import Logo from "@/components/Logo";
import { BLOG_POSTS, formatPostDate, getCategory, getPostBySlug } from "../posts";

const SITE_URL = "https://www.cleartill.money";

export function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};
  const url = `${SITE_URL}/blog/${post.slug}`;
  return {
    title: post.seoTitle || `${post.title} | ClearTill Journal`,
    description: post.description,
    keywords: post.keywords,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      siteName: "ClearTill",
      title: post.title,
      description: post.description,
      url,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt || post.publishedAt,
      images: [{ url: "/social/cleartill-og-v2.png", width: 1200, height: 630, alt: post.title }],
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.description, images: ["/social/cleartill-og-v2.png"] },
  };
}

function InlineContent({ segments, text }) {
  if (!segments) return text;
  return segments.map((segment, index) => {
    let content = segment.strong ? <strong>{segment.text}</strong> : segment.text;
    if (segment.href?.startsWith("http")) {
      content = <a href={segment.href} rel="noopener noreferrer">{content}</a>;
    } else if (segment.href) {
      content = <Link href={segment.href}>{content}</Link>;
    }
    return <span key={`${segment.text}-${index}`}>{content}</span>;
  });
}

function ArticleBlock({ block, faqs }) {
  if (block.type === "heading") return <h2 id={block.id}>{block.text}</h2>;
  if (block.type === "subheading") return <h3 className="article-subheading" id={block.id}>{block.text}</h3>;
  if (block.type === "quote") return <blockquote>{block.text}</blockquote>;
  if (block.type === "list") return <ul>{block.items.map((item) => <li key={item}>{item}</li>)}</ul>;
  if (block.type === "ordered-list") return <ol>{block.items.map((item, index) => <li key={index}><InlineContent segments={item} /></li>)}</ol>;
  if (block.type === "formula") return <aside className="article-formula"><span>{block.label}</span><strong>=</strong><b>{block.formula}</b></aside>;
  if (block.type === "result") return <p className="article-result"><InlineContent segments={block.segments} /></p>;
  if (block.type === "table") return (
    <div className="article-table-wrap">
      <table>
        <caption className="sr-only">{block.caption}</caption>
        <thead><tr>{block.headers.map((header) => <th scope="col" key={header}>{header}</th>)}</tr></thead>
        <tbody>{block.rows.map((row, rowIndex) => (
          <tr className={rowIndex === block.totalRow ? "is-total" : ""} key={row.join("-")}>
            {row.map((cell, cellIndex) => cellIndex === 0
              ? <th scope="row" key={cell}>{cell}</th>
              : <td key={cell}>{cell}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
  if (block.type === "faqs") return (
    <div className="article-faqs">
      {faqs.map((faq) => <section key={faq.question}><h3>{faq.question}</h3><p>{faq.answer}</p></section>)}
    </div>
  );
  if (block.type === "callout") return <aside className="article-callout"><strong>{block.title}</strong><p>{block.text}</p></aside>;
  return <p><InlineContent segments={block.segments} text={block.text} /></p>;
}

export default async function BlogArticlePage({ params }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();
  const category = getCategory(post.category);
  const articleUrl = `${SITE_URL}/blog/${post.slug}`;
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt || post.publishedAt,
    mainEntityOfPage: articleUrl,
    author: { "@type": "Organization", name: "ClearTill" },
    publisher: { "@type": "Organization", name: "ClearTill", url: SITE_URL },
    image: `${SITE_URL}/social/cleartill-og-v2.png`,
    articleSection: category?.label,
    keywords: post.keywords?.join(", "),
  };
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Journal", item: `${SITE_URL}/blog` },
      { "@type": "ListItem", position: 3, name: post.title, item: articleUrl },
    ],
  };
  const faqSchema = post.faqs?.length ? {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: post.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  } : null;

  return (
    <main className="article-shell">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema).replace(/</g, "\\u003c") }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema).replace(/</g, "\\u003c") }} />
      {faqSchema ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema).replace(/</g, "\\u003c") }} /> : null}
      <header className="blog-header article-header">
        <Link className="blog-logo" href="/" aria-label="ClearTill home"><Logo height={38} /></Link>
        <nav className="blog-nav" aria-label="Main navigation">
          <Link href="/">Home</Link><Link className="is-active" href="/blog">Journal</Link><Link className="blog-nav-cta" href="/dashboard?intent=trial">Try ClearTill</Link>
        </nav>
      </header>

      <article>
        <header className="article-hero">
          <nav className="article-breadcrumb" aria-label="Breadcrumb"><Link href="/blog">Journal</Link><span aria-hidden="true">/</span><span>{category?.label}</span></nav>
          <p className="eyebrow">{category?.label}</p>
          <h1>{post.title}</h1>
          <p className="article-description">{post.description}</p>
          <div className="article-meta"><span>By ClearTill</span><span aria-hidden="true">·</span><time dateTime={post.publishedAt}>{formatPostDate(post.publishedAt)}</time><span aria-hidden="true">·</span><span>{post.readingMinutes} min read</span></div>
        </header>

        <div className="article-layout">
          <aside className="article-summary"><span>In one sentence</span><p>{post.takeaway}</p></aside>
          <div className="article-content">
            {post.content.map((block, index) => <ArticleBlock block={block} faqs={post.faqs || []} key={`${block.type}-${index}`} />)}
            <aside className="article-disclaimer"><strong>Good to know</strong><p>{post.disclaimer || "This guide is general information, not personalised financial advice. Your circumstances are your own."}</p></aside>
          </div>
        </div>
      </article>

      <section className="article-end-cta"><p className="eyebrow">A clearer view before payday</p><h2>Know what&apos;s spoken for—and what isn&apos;t.</h2><Link className="primary-button" href="/dashboard?intent=trial">Try ClearTill free</Link></section>
      <Link className="article-back-link" href="/blog"><span aria-hidden="true">←</span> Back to all guides</Link>
    </main>
  );
}
