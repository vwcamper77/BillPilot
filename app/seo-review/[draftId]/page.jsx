import { verifySeoReviewToken } from "../../../lib/seo-engine/review-token";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Review ClearTill article",
  robots: { index: false, follow: false },
};

const ACTION_COPY = {
  approve: {
    title: "Approve this article?",
    description: "This marks the draft as editorially approved. It does not publish the article automatically.",
    button: "Approve article",
  },
  changes: {
    title: "Request changes?",
    description: "Add the changes required. The article will return to the drafting queue.",
    button: "Request changes",
  },
  reject: {
    title: "Reject this article?",
    description: "The draft will be retained in the audit trail but removed from the approval queue.",
    button: "Reject article",
  },
};

export default async function SeoReviewPage({ params, searchParams }) {
  const resolvedParams = await params;
  const resolvedSearch = await searchParams;
  const draftId = resolvedParams?.draftId;
  const action = resolvedSearch?.action;
  const token = resolvedSearch?.token;
  const result = verifySeoReviewToken(token, { expectedAction: action });
  const copy = ACTION_COPY[action];

  if (!copy || !result.valid || result.claims.draftId !== draftId) {
    return (
      <main style={{ maxWidth: 640, margin: "80px auto", padding: 24, fontFamily: "Arial, sans-serif" }}>
        <h1>Review link unavailable</h1>
        <p>This review link is invalid, expired or does not match the article.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 640, margin: "80px auto", padding: 24, fontFamily: "Arial, sans-serif" }}>
      <p style={{ color: "#5d6d7e" }}>ClearTill Journal review</p>
      <h1>{copy.title}</h1>
      <p>{copy.description}</p>
      <form method="post" action="/api/seo/review" style={{ marginTop: 28 }}>
        <input type="hidden" name="draftId" value={draftId} />
        <input type="hidden" name="action" value={action} />
        <input type="hidden" name="token" value={token} />
        {action !== "approve" ? (
          <label style={{ display: "block", marginBottom: 20 }}>
            <span style={{ display: "block", fontWeight: 700, marginBottom: 8 }}>
              {action === "changes" ? "Required changes" : "Reason (optional)"}
            </span>
            <textarea
              name="feedback"
              required={action === "changes"}
              maxLength={2000}
              rows={7}
              style={{ width: "100%", padding: 12, boxSizing: "border-box" }}
            />
          </label>
        ) : null}
        <button type="submit" style={{ border: 0, borderRadius: 8, padding: "12px 18px", fontWeight: 700, cursor: "pointer" }}>
          {copy.button}
        </button>
      </form>
    </main>
  );
}
