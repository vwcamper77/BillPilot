"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Logo from "@/components/Logo";
import { auth, authPersistenceReady } from "@/lib/firebase";
import styles from "./seoArticles.module.css";

const FILTERS = [
  ["all", "All"],
  ["awaiting_review", "Awaiting review"],
  ["changes_requested", "Changes requested"],
  ["approved", "Approved"],
  ["publication_ready", "Publication ready"],
  ["rejected", "Rejected"],
  ["failed", "Failed"],
];

const METRIC_LABELS = {
  draftsGenerated: "Drafts generated",
  generationFailures: "Generation failures",
  reviewEmailsSent: "Review emails sent",
  reviewEmailFailures: "Review email failures",
  approved: "Approved",
  changesRequested: "Changes requested",
  rejected: "Rejected",
  averageArticleQuality: "Average article quality",
  averageEditorialScore: "Average editorial score",
  averageHeroScore: "Average hero score",
  estimatedOpenAiCostToday: "Estimated OpenAI cost today",
  estimatedOpenAiCostMonth: "Estimated OpenAI cost this month",
};

function statusLabel(value) {
  return String(value || "unknown")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function score(value) {
  return value === null || value === undefined ? "Not available" : `${value}/100`;
}

function metricValue(key, value) {
  if (value === null || value === undefined) return "Not recorded";
  if (key.startsWith("estimatedOpenAiCost")) {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      minimumFractionDigits: 2,
    }).format(value);
  }
  if (key.startsWith("average")) return `${value}/100`;
  return Number(value).toLocaleString("en-GB");
}

function matchesFilter(article, filter) {
  if (filter === "all") return true;
  if (filter === "awaiting_review") {
    return ["email_pending", "in_review"].includes(article.decisionStatus);
  }
  if (filter === "approved") return article.decisionStatus === "approved";
  if (filter === "failed") return ["failed", "quality_failed"].includes(article.status);
  return article.status === filter || article.decisionStatus === filter;
}

export default function SeoArticlesAdminPage() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState("all");
  const [status, setStatus] = useState({ loading: true, forbidden: false, error: "" });
  const [action, setAction] = useState({ loading: "", message: "", error: "" });

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

  const loadDashboard = useCallback(async () => {
    if (!user) return;
    setStatus({ loading: true, forbidden: false, error: "" });
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/admin/seo-articles", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if ([401, 403].includes(response.status)) {
        setStatus({ loading: false, forbidden: true, error: "" });
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Could not load SEO articles.");
      }
      setData(payload);
      setStatus({ loading: false, forbidden: false, error: "" });
    } catch (error) {
      setStatus({
        loading: false,
        forbidden: false,
        error: error.message || "Could not load SEO articles.",
      });
    }
  }, [user]);

  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      setStatus({ loading: false, forbidden: true, error: "" });
      return;
    }
    loadDashboard();
  }, [authReady, user, loadDashboard]);

  const performAction = useCallback(async (articleId, path, body, label) => {
    setAction({ loading: label, message: "", error: "" });
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/admin/seo-articles/${articleId}/${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "The action could not be completed.");
      }
      setAction({
        loading: "",
        message: payload.duplicatePrevented
          ? "Duplicate prevented. The existing review package remains valid."
          : payload.sent
            ? "Finished article review package sent."
            : "Review decision recorded.",
        error: "",
      });
      await loadDashboard();
    } catch (error) {
      setAction({ loading: "", message: "", error: error.message || "Action failed." });
    }
  }, [loadDashboard, user]);

  const articles = useMemo(
    () => (data?.articles || []).filter((article) => matchesFilter(article, filter)),
    [data, filter],
  );

  if (!authReady || (status.loading && !data)) {
    return <main className={styles.statePage}><p>Loading SEO article operations…</p></main>;
  }
  if (status.forbidden) {
    return (
      <main className={styles.statePage}>
        <Logo height={40} />
        <h1>Access denied</h1>
        <p>You do not have permission to manage ClearTill SEO articles.</p>
        <Link href="/dashboard">Return to dashboard</Link>
      </main>
    );
  }

  const today = data?.today;
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>ClearTill admin</p>
          <h1>SEO article engine</h1>
          <p>Review drafts, approved hero assets, and publication-ready exports.</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" onClick={loadDashboard} disabled={status.loading}>
            {status.loading ? "Refreshing…" : "Refresh"}
          </button>
          <Link href="/admin/email-operations">Email operations</Link>
        </div>
      </header>

      {status.error ? <p className={styles.error} role="alert">{status.error}</p> : null}
      {action.message ? <p className={styles.success} role="status">{action.message}</p> : null}
      {action.error ? <p className={styles.error} role="alert">{action.error}</p> : null}

      <section className={styles.section} aria-labelledby="engine-status-title">
        <div className={styles.sectionHeading}>
          <div><p className={styles.eyebrow}>Operations</p><h2 id="engine-status-title">Engine status</h2></div>
          <div className={styles.statusPair}>
            <StatusPill active={data?.engine.enabled} label={`Engine ${data?.engine.enabled ? "enabled" : "disabled"}`} />
            <StatusPill active={false} label="Recurring SEO cron disabled" />
          </div>
        </div>
        <div className={styles.statGrid}>
          <Stat label="Last attempted run" value={formatDate(data?.engine.lastAttemptedRun?.attemptedAt)} />
          <Stat label="Last successful run" value={formatDate(data?.engine.lastSuccessfulRun?.attemptedAt)} />
          <Stat label="Last failed run" value={formatDate(data?.engine.lastFailedRun?.attemptedAt)} />
          <Stat label="Awaiting review" value={data?.engine.counts.awaitingReview} />
          <Stat label="Changes requested" value={data?.engine.counts.changesRequested} />
          <Stat label="Publication ready" value={data?.engine.counts.publicationReady} />
          <Stat label="Rejected" value={data?.engine.counts.rejected} />
        </div>
      </section>

      <section className={styles.section} aria-labelledby="today-title">
        <div className={styles.sectionHeading}>
          <div><p className={styles.eyebrow}>Latest finished work</p><h2 id="today-title">Today&apos;s article</h2></div>
        </div>
        {today ? (
          <div className={styles.currentGrid}>
            <div className={styles.heroCard}>
              {today.hero.approved ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={today.hero.urls.master} alt={today.hero.title || today.title} />
              ) : <div className={styles.heroUnavailable}>Approved hero unavailable</div>}
              <div>
                <span>{today.hero.title || "Hero title not recorded"}</span>
                <strong>{score(today.hero.score)}</strong>
              </div>
            </div>
            <div className={styles.articleDetails}>
              <div>
                <span className={styles.badge}>{statusLabel(today.status)}</span>
                <span className={styles.badge}>v{today.version}</span>
                <span className={today.published ? styles.dangerBadge : styles.safeBadge}>
                  {today.published ? "Published" : "Unpublished"}
                </span>
              </div>
              <h3>{today.title}</h3>
              <dl className={styles.detailList}>
                <Detail label="Primary keyword" value={today.primaryKeyword} />
                <Detail label="Topic / cluster" value={today.topic} />
                <Detail label="Deterministic quality" value={score(today.qualityScore)} />
                <Detail label="Editorial score" value={score(today.editorialScore)} />
                <Detail label="Hero status" value={statusLabel(today.heroStatus)} />
                <Detail label="Review email" value={statusLabel(today.reviewEmailStatus)} />
                <Detail label="Generated" value={formatDate(today.generatedAt)} />
                <Detail label="Approved" value={formatDate(today.approvalAt)} />
                <Detail label="Publication" value={today.published ? "Published" : "Publication ready — not published"} />
              </dl>
              <div className={styles.actionGrid}>
                <Link href={`/admin/seo-articles/${today.id}/preview`}>Open finished article</Link>
                {today.hero.urls.master ? <a href={today.hero.urls.master}>View corrected hero</a> : null}
                {today.hero.urls.mobile ? <a href={today.hero.urls.mobile}>View mobile hero</a> : null}
                <Link href={`/admin/seo-articles/${today.id}/preview?mode=sources`}>View sources</Link>
                <Link href={`/admin/seo-articles/${today.id}/preview?mode=editorial`}>View quality report</Link>
                <Link href={`/admin/seo-articles/${today.id}/preview?mode=export`}>View publication export</Link>
                <button
                  type="button"
                  disabled={Boolean(action.loading)}
                  onClick={() => performAction(today.id, "review-package", { resend: false }, "send")}
                >
                  {action.loading === "send" ? "Sending…" : "Send finished article for review"}
                </button>
                <button
                  type="button"
                  disabled={Boolean(action.loading)}
                  onClick={() => performAction(today.id, "review-package", {
                    resend: true,
                    revision: `resend-${window.crypto.randomUUID()}`,
                  }, "resend")}
                >
                  {action.loading === "resend" ? "Resending…" : "Resend review package"}
                </button>
                {today.eligibleActions.map((decision) => (
                  <button
                    type="button"
                    className={decision === "reject" ? styles.rejectButton : ""}
                    disabled={Boolean(action.loading)}
                    key={decision}
                    onClick={() => performAction(today.id, "decision", {
                      action: decision,
                      versionId: today.versionId,
                    }, decision)}
                  >
                    {statusLabel(decision)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <h3>No SEO articles yet</h3>
            <p>The bounded latest-30 query returned no drafts.</p>
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="recent-title">
        <div className={styles.sectionHeading}>
          <div><p className={styles.eyebrow}>Bounded to 30</p><h2 id="recent-title">Recent articles</h2></div>
          <select aria-label="Filter recent articles" value={filter} onChange={(event) => setFilter(event.target.value)}>
            {FILTERS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>Article</th><th>Version</th><th>Keyword</th><th>Status</th><th>Quality</th><th>Editorial</th><th>Hero</th><th>Email</th><th>Generated</th><th>Decision</th></tr></thead>
            <tbody>{articles.length ? articles.map((article) => (
              <tr key={article.id}>
                <td>{article.previewAvailable
                  ? <Link href={`/admin/seo-articles/${article.id}/preview`}>{article.title}</Link>
                  : <span>{article.title}</span>}</td>
                <td>v{article.version}</td>
                <td>{article.primaryKeyword || "Not recorded"}</td>
                <td>{statusLabel(article.status)}</td>
                <td>{score(article.qualityScore)}</td>
                <td>{article.editorialRecommendation || "Not available"}</td>
                <td>{score(article.heroScore)}</td>
                <td>{statusLabel(article.reviewEmailStatus)}</td>
                <td>{formatDate(article.generatedAt)}</td>
                <td>{formatDate(article.decisionAt)}</td>
              </tr>
            )) : <tr><td colSpan={10}>No articles match this filter.</td></tr>}</tbody>
          </table>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="metrics-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Stored aggregates only</p><h2 id="metrics-title">Operational metrics</h2></div></div>
        <div className={styles.metricGrid}>
          {Object.entries(METRIC_LABELS).map(([key, label]) => (
            <Stat key={key} label={label} value={metricValue(key, data?.metrics?.[key])} />
          ))}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="integrations-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>External data</p><h2 id="integrations-title">External integrations</h2></div></div>
        <div className={styles.integrationGrid}>
          {Object.values(data?.integrations || {}).map((integration) => (
            <div key={integration.label}><span aria-hidden="true">○</span><strong>{integration.label}</strong></div>
          ))}
        </div>
      </section>
    </main>
  );
}

function StatusPill({ active, label }) {
  return <span className={active ? styles.activeStatus : styles.inactiveStatus}>{label}</span>;
}

function Stat({ label, value }) {
  return <div className={styles.stat}><span>{label}</span><strong>{value ?? "Not recorded"}</strong></div>;
}

function Detail({ label, value }) {
  return <><dt>{label}</dt><dd>{value || "Not recorded"}</dd></>;
}
