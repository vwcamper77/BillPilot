import Link from "next/link";
import Logo from "@/components/Logo";

export const metadata = {
  title: "Review recorded | ClearTill",
  robots: { index: false, follow: false },
};

const OUTCOMES = {
  expired: {
    title: "Review action expired",
    body: "This signed review action has expired. Ask a ClearTill administrator to resend the finished review package.",
  },
  completed: {
    title: "Review already completed",
    body: "A decision has already been recorded for this article version. No additional change was made.",
  },
  stale: {
    title: "Article version changed",
    body: "This action targets a stale version. Open the latest finished article before making a decision.",
  },
  invalid: {
    title: "Review action unavailable",
    body: "This review action is invalid or has been replaced. No change was made.",
  },
};

export default async function SeoReviewResultPage({ searchParams }) {
  const query = await searchParams;
  const approved = query?.outcome === "success" && query?.action === "approve";
  const requestedChanges = query?.outcome === "success" && query?.action === "request_changes";
  const rejected = query?.outcome === "success" && query?.action === "reject";
  const fallback = OUTCOMES[query?.outcome] || OUTCOMES.invalid;
  const title = approved
    ? "Article approved"
    : requestedChanges
      ? "Changes requested"
      : rejected
        ? "Article rejected"
        : fallback.title;
  const body = approved
    ? "The article has been approved successfully. It has been exported and is ready for publication."
    : requestedChanges
      ? "The requested changes have been recorded. The article remains unpublished."
      : rejected
        ? "The rejection has been recorded. The article remains unpublished."
        : fallback.body;
  const articleId = String(query?.articleId || "");
  const version = String(query?.version || "");
  return (
    <main style={{ minHeight: "75vh", display: "grid", placeItems: "center", padding: 24, background: "#f7f4ed", color: "#143c3a" }}>
      <section style={{ width: "min(680px, 100%)", padding: "36px", borderRadius: 20, background: "white", boxShadow: "0 24px 70px rgba(20,60,58,.1)" }}>
        <Logo height={42} />
        <p style={{ marginTop: 28, color: "#278a68", fontWeight: 800, letterSpacing: ".12em", fontSize: 12 }}>CLEARTILL JOURNAL REVIEW</p>
        <h1>{title}</h1>
        <p style={{ lineHeight: 1.7 }}>{body}</p>
        {articleId ? (
          <dl style={{ display: "grid", gridTemplateColumns: "120px 1fr", margin: "24px 0", padding: 16, borderRadius: 12, background: "#eef8f3" }}>
            <dt>Reference</dt><dd style={{ margin: 0 }}>{articleId}</dd>
            <dt>Version</dt><dd style={{ margin: 0 }}>v{version || "1"}</dd>
            <dt>Status</dt><dd style={{ margin: 0 }}>{approved ? "Publication ready — not published" : String(query?.status || "Unpublished").replaceAll("_", " ")}</dd>
          </dl>
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 26 }}>
          <Link style={{ padding: "11px 15px", borderRadius: 9, background: "#143c3a", color: "white", textDecoration: "none", fontWeight: 750 }} href="/admin/seo-articles">Return to SEO dashboard</Link>
          {articleId ? <Link style={{ padding: "11px 15px", borderRadius: 9, background: "#eef8f3", color: "#143c3a", textDecoration: "none", fontWeight: 750 }} href={`/admin/seo-articles/${articleId}/preview`}>View approved article</Link> : null}
          {articleId ? <Link style={{ padding: "11px 15px", borderRadius: 9, background: "#eef8f3", color: "#143c3a", textDecoration: "none", fontWeight: 750 }} href={`/admin/seo-articles/${articleId}/preview?mode=export`}>View publication export</Link> : null}
        </div>
      </section>
    </main>
  );
}
