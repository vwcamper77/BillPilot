"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

function PostCard({ post, featured = false }) {
  return (
    <article className={`blog-card${featured ? " blog-card-featured" : ""}`}>
      <Link className="blog-card-link" href={`/blog/${post.slug}`} aria-label={`Read ${post.title}`}>
        <div className={`blog-card-art blog-card-art-${post.category}`} aria-hidden="true">
          <span>{post.categoryLabel}</span>
          <i />
        </div>
        <div className="blog-card-body">
          <div className="blog-card-meta">
            <span>{post.categoryLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{post.readingMinutes} min read</span>
          </div>
          <h2>{post.title}</h2>
          <p>{post.description}</p>
          <div className="blog-card-foot">
            <time dateTime={post.publishedAt}>{post.formattedDate}</time>
            <span className="blog-read-link">Read guide <span aria-hidden="true">→</span></span>
          </div>
        </div>
      </Link>
    </article>
  );
}

export default function BlogExplorer({ posts, categories }) {
  const [activeCategory, setActiveCategory] = useState("all");
  const [query, setQuery] = useState("");

  const visiblePosts = useMemo(() => {
    const normalisedQuery = query.trim().toLocaleLowerCase("en-GB");
    return posts.filter((post) => {
      const categoryMatches = activeCategory === "all" || post.category === activeCategory;
      const queryMatches = !normalisedQuery || `${post.title} ${post.description} ${post.categoryLabel}`
        .toLocaleLowerCase("en-GB")
        .includes(normalisedQuery);
      return categoryMatches && queryMatches;
    });
  }, [activeCategory, posts, query]);

  if (!posts.length) {
    return (
      <section className="blog-empty" aria-labelledby="blog-empty-title">
        <div className="blog-empty-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <p className="eyebrow">The first edition</p>
          <h2 id="blog-empty-title">Practical guides are on the way.</h2>
          <p>
            We&apos;re preparing clear, useful reads about bills, payday and everyday money.
            No jargon, no judgement and no unrealistic budgeting rules.
          </p>
        </div>
      </section>
    );
  }

  const featuredPost = activeCategory === "all" && !query ? visiblePosts.find((post) => post.featured) : null;
  const gridPosts = featuredPost ? visiblePosts.filter((post) => post.slug !== featuredPost.slug) : visiblePosts;

  return (
    <section className="blog-explorer" aria-labelledby="latest-guides">
      <div className="blog-explorer-head">
        <div>
          <p className="eyebrow">The latest</p>
          <h2 id="latest-guides">Guides for everyday money</h2>
        </div>
        {posts.length > 5 ? (
          <label className="blog-search">
            <span className="sr-only">Search guides</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></svg>
            <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Search guides" />
          </label>
        ) : null}
      </div>

      <div className="blog-filter-row" aria-label="Filter guides by topic">
        <button className={activeCategory === "all" ? "is-active" : ""} onClick={() => setActiveCategory("all")} type="button">All guides</button>
        {categories.map((category) => (
          <button className={activeCategory === category.slug ? "is-active" : ""} key={category.slug} onClick={() => setActiveCategory(category.slug)} type="button">
            {category.label}
          </button>
        ))}
      </div>

      {featuredPost ? <PostCard post={featuredPost} featured /> : null}
      {gridPosts.length ? (
        <div className="blog-card-grid">
          {gridPosts.map((post) => <PostCard post={post} key={post.slug} />)}
        </div>
      ) : (
        <p className="blog-no-results">No guides match that search yet. Try another word or topic.</p>
      )}
    </section>
  );
}
