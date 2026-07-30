"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Logo from "@/components/Logo";
import JournalArticleContent from "@/components/journal/JournalArticleContent";
import { auth, authPersistenceReady } from "@/lib/firebase";
import styles from "./preview.module.css";

const MODES = [
  ["desktop", "Desktop article"],
  ["mobile", "Mobile article"],
  ["hero-master", "Hero master"],
  ["hero-mobile", "Hero mobile"],
  ["editorial", "Editorial review"],
  ["sources", "Sources and claims"],
  ["live-simulation", "Live-Journal simulation"],
  ["export", "Publication export"],
];

function formatDate(value) {
  if (!value) return "Publication date to be set";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "long" }).format(new Date(value));
}

function scoreFromChecks(report) {
  const values = Object.values(report?.checks || {});
  return values.length ? Math.round((values.filter(Boolean).length / values.length) * 100) : null;
}

function articleMode(mode) {
  return mode === "desktop" || mode === "mobile" || mode === "live-simulation";
}

export default function PreviewClient({ articleId, initialMode }) {
  const [mode, setMode] = useState(MODES.some(([value]) => value === initialMode) ? initialMode : "desktop");
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [data, setData] = useState(null);
  const [status, setStatus] = useState({ loading: true, forbidden: false, error: "" });

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return undefined;
    }
    let mounted = true;
    let unsubscribe = () => undefined;
    authPersistenceReady.finally(() => {
      if (!mounted) return;
      unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        setUser(currentUser);
        setAuthReady(true);
      });
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      setStatus({ loading: false, forbidden: true, error: "" });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch(`/api/admin/seo-articles/${encodeURIComponent(articleId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if ([401, 403].includes(response.status)) {
          if (!cancelled) setStatus({ loading: false, forbidden: true, error: "" });
          return;
        }
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.error || "Preview unavailable.");
        if (!cancelled) {
          setData(payload);
          setStatus({ loading: false, forbidden: false, error: "" });
        }
      } catch (error) {
        if (!cancelled) {
          setStatus({ loading: false, forbidden: false, error: error.message || "Preview unavailable." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [articleId, authReady, user]);

  if (!authReady || status.loading) {
    return <main className={styles.state}><p>Loading finished article preview…</p></main>;
  }
  if (status.forbidden) {
    return (
      <main className={styles.state}>
        <Logo height={40} />
        <h1>Access denied</h1>
        <p>This unpublished article is available only to authorised ClearTill administrators.</p>
        <Link href="/dashboard">Return to dashboard</Link>
      </main>
    );
  }
  if (status.error || !data) {
    return <main className={styles.state}><h1>Preview unavailable</h1><p>{status.error}</p></main>;
  }

  const { article, hero, publication, summary } = data;
  return (
    <main className={styles.page}>
      <header className={styles.toolbar}>
        <div>
          <Link href="/admin/seo-articles" className={styles.backLink}>← SEO dashboard</Link>
          <div className={styles.unpublished}>Unpublished preview</div>
          <strong>{article.title}</strong>
          <span>Version {data.version.id} · {publication.published ? "Published" : "Not published"}</span>
        </div>
        <nav aria-label="Article preview modes">
          {MODES.map(([value, label]) => (
            <button
              type="button"
              aria-pressed={mode === value}
              className={mode === value ? styles.activeMode : ""}
              onClick={() => setMode(value)}
              key={value}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {articleMode(mode) ? (
        <div className={mode === "mobile" ? styles.mobileFrame : styles.desktopFrame}>
          <article className={`article-shell ${styles.articlePreview}`}>
            <header className="blog-header article-header">
              <Logo height={38} />
              <span className={styles.previewMarker}>Unpublished preview</span>
            </header>
            {hero.approved ? (
              <figure className={`article-hero-image ${styles.topHero}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mode === "mobile" ? hero.urls.mobile : hero.urls.master}
                  alt={hero.title || article.description}
                />
              </figure>
            ) : <aside className={styles.heroWarning}>Approved hero unavailable.</aside>}
            <header className="article-hero">
              <p className="eyebrow">{article.category?.replaceAll("-", " ")}</p>
              <h1>{article.title}</h1>
              <p className="article-description">{article.description}</p>
              <div className="article-meta">
                <span>By ClearTill</span><span aria-hidden="true">·</span>
                <span>{formatDate(null)}</span><span aria-hidden="true">·</span>
                <span>{article.readingMinutes} min read</span>
              </div>
            </header>
            <div className="article-layout">
              <aside className="article-summary">
                <span>In one sentence</span><p>{article.takeaway}</p>
              </aside>
              <div className="article-content">
                <JournalArticleContent article={article} />
                <aside className="article-disclaimer">
                  <strong>Good to know</strong>
                  <p>{article.disclaimer || "This guide is general information, not personalised financial advice."}</p>
                </aside>
              </div>
            </div>
            <section className="article-end-cta">
              <p className="eyebrow">A clearer view before payday</p>
              <h2>{article.cta?.title || "Know what’s spoken for—and what isn’t."}</h2>
              <Link className="primary-button" href={data.metrics.ctaDestination}>
                {article.cta?.label || "Start my no-card preview"}
              </Link>
            </section>
          </article>
        </div>
      ) : null}

      {mode === "hero-master" ? (
        <AssetPanel
          title="Corrected master hero · 1600×900"
          src={hero.urls.master}
          alt={hero.title}
          available={hero.approved}
        />
      ) : null}
      {mode === "hero-mobile" ? (
        <AssetPanel
          title="Corrected mobile hero · 390×219"
          src={hero.urls.mobile}
          alt={hero.title}
          available={hero.approved}
          mobile
        />
      ) : null}
      {mode === "editorial" ? (
        <section className={styles.reviewPanel}>
          <p className={styles.panelEyebrow}>Editorial review</p>
          <h1>{article.title}</h1>
          <div className={styles.reviewGrid}>
            <ReviewStat label="Deterministic quality" value={`${scoreFromChecks(data.qualityReport) ?? "Not recorded"}/100`} />
            <ReviewStat label="Editorial score" value={data.editorial.score === null ? "Not available" : `${data.editorial.score}/100`} />
            <ReviewStat label="Recommendation" value={data.editorial.recommendation || "Not available"} />
            <ReviewStat label="Hero vision" value={`${hero.score ?? "Not recorded"}/100`} />
          </div>
          <h2>Quality gates</h2>
          <ul className={styles.checkList}>
            {Object.entries(data.qualityReport?.checks || {}).map(([name, passed]) => (
              <li key={name}><span>{passed ? "✓" : "×"}</span><strong>{name}</strong><em>{passed ? "Pass" : "Fail"}</em></li>
            ))}
          </ul>
          <h2>AI editorial comments</h2>
          {data.editorial.comments.length
            ? <ul>{data.editorial.comments.map((comment) => <li key={comment}>{comment}</li>)}</ul>
            : <p>No AI editorial comments are stored for this version.</p>}
        </section>
      ) : null}
      {mode === "sources" ? (
        <section className={styles.reviewPanel}>
          <p className={styles.panelEyebrow}>Evidence record</p>
          <h1>Sources and claims</h1>
          <div className={styles.sourceGrid}>
            <div><h2>Sources</h2><ol>{data.sources.map((source) => (
              <li key={source.id}>
                <a href={source.url} rel="noopener noreferrer">{source.title}</a>
                <span>{source.publisher} · accessed {source.accessedAt}</span>
                <small>Supports: {(source.claimIds || []).join(", ")}</small>
              </li>
            ))}</ol></div>
            <div><h2>Material claims</h2><ol>{data.claims.map((claim) => (
              <li key={claim.id}>
                <strong>{claim.statement}</strong>
                <span>{claim.material ? "Material claim" : "Supporting statement"}</span>
                <small>Sources: {(claim.sourceIds || []).join(", ")}</small>
              </li>
            ))}</ol></div>
          </div>
        </section>
      ) : null}
      {mode === "export" ? (
        <section className={styles.reviewPanel}>
          <p className={styles.panelEyebrow}>Publication boundary</p>
          <h1>Publication-ready export</h1>
          <div className={styles.reviewGrid}>
            <ReviewStat label="Article ID" value={articleId} />
            <ReviewStat label="Version" value={data.version.id} />
            <ReviewStat label="Status" value="Publication ready — not published" />
            <ReviewStat label="Live collection" value={publication.exportedToLiveCollection ? "Exported" : "Not exported"} />
          </div>
          <aside className={styles.boundary}>
            This export is ready for a separate publication step. Viewing or reviewing it does not publish the article.
          </aside>
          <Link href={`/admin/seo-articles/${articleId}/preview`}>View approved article</Link>
        </section>
      ) : null}

      <section className={styles.reviewPanel}>
        <p className={styles.panelEyebrow}>Version and delivery state</p>
        <h2>Immutable version history</h2>
        <div className={styles.reviewGrid}>
          <ReviewStat label="Scheduled date" value={data.schedule?.scheduledFor ? formatDate(data.schedule.scheduledFor) : "Not scheduled"} />
          <ReviewStat label="Buffer status" value={data.bufferDistribution?.status?.replaceAll("_", " ") || "Not generated"} />
          <ReviewStat label="Buffer scheduled" value={String(data.bufferDistribution?.scheduledCount || 0)} />
          <ReviewStat label="Promoted" value={String(data.bufferDistribution?.promotedCount || 0)} />
        </div>
        <ol>
          {(data.versionHistory || []).map((item) => (
            <li key={item.id}>
              <strong>{item.id}</strong>
              {" · "}{item.immutable ? "immutable" : "draft snapshot"}
              {" · "}{item.createdAt ? formatDate(item.createdAt) : "date not recorded"}
            </li>
          ))}
        </ol>
        {mode === "live-simulation" ? (
          <aside className={styles.boundary}>
            Live-Journal simulation uses the public renderer and styling, but this version remains unpublished and absent from the public repository.
          </aside>
        ) : null}
      </section>

      <footer className={styles.footerMeta}>
        <span>Article reference: {articleId}</span>
        <span>Status: {summary.status.replaceAll("_", " ")}</span>
        <span>Published: {publication.published ? "true" : "false"}</span>
      </footer>
    </main>
  );
}

function AssetPanel({ title, src, alt, available, mobile = false }) {
  return (
    <section className={styles.assetPanel}>
      <p className={styles.panelEyebrow}>Approved asset</p>
      <h1>{title}</h1>
      {available ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={mobile ? styles.mobileAsset : ""} src={src} alt={alt} />
      ) : <p>Only heroes that pass deterministic and vision QA are displayed.</p>}
    </section>
  );
}

function ReviewStat({ label, value }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}
