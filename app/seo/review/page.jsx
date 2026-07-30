import Link from "next/link";
import Logo from "@/components/Logo";
import { getSeoArticleReview } from "@/lib/seoArticles/engine.server";

export const metadata = {
  title: "Review Journal article | ClearTill",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

function actionLabel(action) {
  if (action === "approve") return "Approve publication-ready export";
  if (action === "request_changes") return "Request changes";
  return "Reject draft";
}

export default async function SeoArticleReviewPage({ searchParams }) {
  const query = await searchParams;
  const token = typeof query?.token === "string" ? query.token : "";
  let review;
  try {
    review = await getSeoArticleReview(token);
  } catch {
    return (
      <main style={{ minHeight: "75vh", display: "grid", placeItems: "center", padding: 24, background: "#f7f4ed", color: "#143c3a" }}>
        <section style={{ width: "min(680px, 100%)", padding: 36, borderRadius: 20, background: "white", boxShadow: "0 24px 70px rgba(20,60,58,.1)" }}>
          <Logo height={42} />
          <p style={{ marginTop: 28, color: "#278a68", fontWeight: 800, letterSpacing: ".12em", fontSize: 12 }}>CLEARTILL JOURNAL REVIEW</p>
          <h1>This review link is invalid or expired.</h1>
          <p>Ask the ClearTill content administrator to send a fresh finished-article review package. No decision was recorded.</p>
          <Link style={{ display: "inline-block", marginTop: 18, padding: "11px 15px", borderRadius: 9, background: "#143c3a", color: "white", textDecoration: "none", fontWeight: 750 }} href="/admin/seo-articles">
            Return to SEO dashboard
          </Link>
        </section>
      </main>
    );
  }
  return (
    <main style={{ maxWidth: 820, margin: "48px auto", padding: 24, fontFamily: "Arial, sans-serif", color: "#143c3a", lineHeight: 1.6 }}>
      <p style={{ color: "#278a68", fontWeight: 700 }}>CLEARTILL JOURNAL REVIEW</p>
      <h1>{review.article.title}</h1>
      {review.heroDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={review.heroDataUrl} alt={review.article.description} style={{ width: "100%", height: "auto", borderRadius: 18 }} />
      ) : (
        <aside style={{ background: "#fff8e8", padding: 16, borderRadius: 10 }}>
          Image review required. No hero image was attached because automated image QA did not pass.
        </aside>
      )}
      <p><strong>{review.article.description}</strong></p>
      {(review.article.content || []).map((block, index) => {
        if (block.type === "heading") return <h2 id={block.id} key={`${block.type}-${index}`}>{block.text}</h2>;
        if (block.type === "list") return <ul key={`${block.type}-${index}`}>{block.items.map((item) => <li key={item}>{item}</li>)}</ul>;
        return <p key={`${block.type}-${index}`}>{block.text}</p>;
      })}
      <h2>Sources</h2>
      <ol>{review.sources.map((source) => (
        <li key={source.id}><a href={source.url} rel="noreferrer">{source.title}</a> — {source.publisher} ({source.claimIds.join(", ")})</li>
      ))}</ol>
      <h2>Quality report</h2>
      <ul>{Object.entries(review.qualityReport.checks).map(([name, passed]) => (
        <li key={name}>{name}: <strong>{passed ? "PASS" : "FAIL"}</strong></li>
      ))}</ul>
      <h2>Hero image QA</h2>
      <p>
        <strong>{review.imageQa?.passed ? "PASS" : "REVIEW REQUIRED"}</strong>
        {" · "}score {review.imageQa?.visionScore ?? 0}/100
        {" · "}attempt {review.imageQa?.attemptCount ?? 0}
        {" · "}layout {review.imageQa?.finalLayoutVariant || "none"}
      </p>
      {review.imageQa?.issues?.length ? (
        <ul>{review.imageQa.issues.map((issue, index) => (
          <li key={`${issue.category}-${index}`}><strong>{issue.severity}</strong>: {issue.message}</li>
        ))}</ul>
      ) : null}
      <aside style={{ background: "#eef8f3", padding: 16, borderRadius: 10 }}>
        Approval creates a publication-ready export. It does not publish the article or image.
      </aside>
      <form action="/api/seo-articles/review" method="post" style={{ marginTop: 24 }}>
        <input type="hidden" name="token" value={token} />
        {review.action === "request_changes" ? (
          <label style={{ display: "block", marginBottom: 16 }}>
            Requested changes
            <textarea name="note" rows={5} required style={{ display: "block", width: "100%", marginTop: 6 }} />
          </label>
        ) : null}
        <button type="submit" style={{ border: 0, borderRadius: 9, padding: "14px 22px", background: review.action === "reject" ? "#9b3d35" : "#143c3a", color: "white", fontWeight: 700 }}>
          Confirm: {actionLabel(review.action)}
        </button>
      </form>
    </main>
  );
}
