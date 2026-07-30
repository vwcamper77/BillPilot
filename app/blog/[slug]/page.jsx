import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import Logo from "@/components/Logo";
import JournalArticleContent from "@/components/journal/JournalArticleContent";
import { BLOG_POSTS, formatPostDate, getCategory } from "../posts";
import {
  getPublishedJournalPostBySlug,
  getRelatedJournalPosts,
} from "@/lib/journal/repository.server";
import { createPageMetadata, HOME_URL, SITE_URL, SOCIAL_IMAGE_URL } from "@/lib/seo";
import { createGmbfOrganizationSchema } from "@/lib/productFamily";

export function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const post = await getPublishedJournalPostBySlug(slug);
  if (!post) return {};
  const pageMetadata = createPageMetadata({
    title: post.seoTitle || post.title,
    description: post.description,
    path: `/blog/${post.slug}`,
    type: "article",
  });
  return {
    ...pageMetadata,
    keywords: post.keywords,
    openGraph: {
      ...pageMetadata.openGraph,
      images: post.heroImage?.src ? [{ url: post.heroImage.src, alt: post.heroImage.alt }] : pageMetadata.openGraph.images,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt || post.publishedAt,
    },
  };
}

function DashboardHierarchyPreview() {
  return (
    <figure className="article-dashboard-preview" aria-label="The ClearTill dashboard hierarchy for irregular income">
      <div className="preview-app-header"><Logo height={25} /><span>Overview</span></div>
      <div className="preview-result-card">
        <span className="status-pill">On track</span>
        <strong>Available before your next reliable payment</strong>
        <p>Per-day guidance for the days remaining</p>
        <div className="preview-formula"><span>Balance</span><b>+</b><span>confirmed income</span><b>−</b><span>committed money</span><b>=</b><span>available</span></div>
        <div className="preview-allocation"><i /><span>Available</span><span>Already committed</span></div>
        <div className="preview-commitments"><span>Due next</span><span>Amount</span><span>Date</span></div>
      </div>
      <figcaption>The amount and reliable-payment date lead; evidence and management stay close without competing with the answer.</figcaption>
    </figure>
  );
}

export default async function BlogArticlePage({ params }) {
  const { slug } = await params;
  const post = await getPublishedJournalPostBySlug(slug);
  if (!post) notFound();
  const category = getCategory(post.category);
  const repositoryRelated = post.relatedLinks?.length
    ? []
    : await getRelatedJournalPosts(post);
  const articleUrl = `${SITE_URL}/blog/${post.slug}`;
  const articleImageUrl = post.heroImage?.src ? `${SITE_URL}${post.heroImage.src}` : SOCIAL_IMAGE_URL;
  const supportingImages = (post.content || []).filter((block) => block.type === "image");
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt || post.publishedAt,
    mainEntityOfPage: articleUrl,
    author: createGmbfOrganizationSchema(),
    publisher: createGmbfOrganizationSchema(),
    image: [articleImageUrl, ...supportingImages.map((item) => `${SITE_URL}${item.src}`)],
    associatedMedia: supportingImages.map((item) => ({
      "@type": "ImageObject",
      contentUrl: `${SITE_URL}${item.src}`,
      caption: item.caption,
      creditText: item.credit,
      license: item.licenceUrl,
    })),
    articleSection: category?.label,
    keywords: post.keywords?.join(", "),
  };
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: HOME_URL },
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
          <Link href="/">Home</Link><Link className="is-active" href="/blog">Journal</Link><Link className="blog-nav-cta" href="/start">Try ClearTill</Link>
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

        {post.heroImage ? (
          <figure className="article-hero-image">
            <Image src={post.heroImage.src} alt={post.heroImage.alt} width={post.heroImage.width} height={post.heroImage.height} priority />
          </figure>
        ) : null}

        {post.slug === "budgeting-irregular-income-no-payday" ? <DashboardHierarchyPreview /> : null}

        <div className="article-layout">
          <aside className="article-summary"><span>In one sentence</span><p>{post.takeaway}</p></aside>
          <div className="article-content">
            <JournalArticleContent article={post} />
            <aside className="article-disclaimer"><strong>Good to know</strong><p>{post.disclaimer || "This guide is general information, not personalised financial advice. Your circumstances are your own."}</p></aside>
          </div>
        </div>
      </article>

      {post.relatedLinks?.length || repositoryRelated.length ? (
        <section className="article-related" aria-labelledby="related-content-title">
          <p className="eyebrow">Keep going</p>
          <h2 id="related-content-title">Related guides and tools</h2>
          <div>
            {(post.relatedLinks || repositoryRelated.map((item) => ({
              type: "article",
              href: `/blog/${item.slug}`,
              title: item.title,
              description: item.description,
            }))).map((item) => (
              <Link href={item.href} key={item.href}>
                <span>{item.type === "tool" ? "Free tool" : "Guide"}</span>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="article-end-cta"><p className="eyebrow">A clearer view before payday</p><h2>Know what&apos;s spoken for—and what isn&apos;t.</h2><Link className="primary-button" href="/start">Start my no-card preview</Link></section>
      <Link className="article-back-link" href="/blog"><span aria-hidden="true">←</span> Back to all guides</Link>
    </main>
  );
}
