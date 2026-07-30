import crypto from "node:crypto";
import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import { sendEmail } from "@/lib/email/emailService.server";
import articleCore from "@/lib/seoArticles/articleCore.cjs";
import { getSeoAdminArticle } from "@/lib/seoArticles/admin.server";

const { signReviewToken } = articleCore;
const PACKAGE_REVISION = "finished-review-v1";
const LEASE_MS = 10 * 60 * 1000;
const EVENTS_COLLECTION = "seoArticleReviewPackages";
const STATE_COLLECTION = "seoArticleReviewPackageState";
const METRICS_COLLECTION = "seoArticleMetrics";

function reviewSecret() {
  const value = String(process.env.SEO_REVIEW_TOKEN_SECRET || "").trim();
  if (!value) throw new Error("SEO_REVIEW_TOKEN_SECRET is not configured.");
  return value;
}

function siteUrl() {
  return String(
    process.env.NEXT_PUBLIC_APP_URL
    || process.env.NEXT_PUBLIC_SITE_URL
    || "https://www.cleartill.money",
  ).replace(/\/+$/, "");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[<>&'"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

function renderInline(segments, text) {
  if (!Array.isArray(segments)) return escapeHtml(text);
  return segments.map((segment) => {
    const value = escapeHtml(typeof segment === "string" ? segment : segment?.text);
    const content = segment?.strong ? `<strong>${value}</strong>` : value;
    if (!segment?.href) return content;
    return `<a href="${escapeHtml(segment.href)}">${content}</a>`;
  }).join("");
}

function renderArticleBlock(block, faqs = []) {
  if (block.type === "heading") return `<h2 id="${escapeHtml(block.id)}">${escapeHtml(block.text)}</h2>`;
  if (block.type === "subheading") return `<h3 id="${escapeHtml(block.id)}">${escapeHtml(block.text)}</h3>`;
  if (block.type === "quote") return `<blockquote>${escapeHtml(block.text)}</blockquote>`;
  if (block.type === "list" || block.type === "ordered-list") {
    const tag = block.type === "ordered-list" ? "ol" : "ul";
    return `<${tag}>${(block.items || []).map((item) => (
      `<li>${typeof item === "string" ? escapeHtml(item) : renderInline(item)}</li>`
    )).join("")}</${tag}>`;
  }
  if (block.type === "formula") {
    return `<aside><strong>${escapeHtml(block.label)}</strong> = ${escapeHtml(block.formula)}</aside>`;
  }
  if (block.type === "result") return `<p><strong>${renderInline(block.segments, block.text)}</strong></p>`;
  if (block.type === "table") {
    return `<table style="border-collapse:collapse;width:100%"><caption>${escapeHtml(block.caption)}</caption>
      <thead><tr>${(block.headers || []).map((header) => `<th style="border:1px solid #d7e1dc;padding:8px;text-align:left">${escapeHtml(header)}</th>`).join("")}</tr></thead>
      <tbody>${(block.rows || []).map((row) => `<tr>${row.map((cell) => `<td style="border:1px solid #d7e1dc;padding:8px">${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>`;
  }
  if (block.type === "faqs") {
    return `<section>${faqs.map((faq) => `<h3>${escapeHtml(faq.question)}</h3><p>${escapeHtml(faq.answer)}</p>`).join("")}</section>`;
  }
  if (block.type === "callout") {
    return `<aside style="padding:16px;background:#eef8f3;border-radius:10px"><strong>${escapeHtml(block.title)}</strong><p>${escapeHtml(block.text)}</p></aside>`;
  }
  return `<p>${renderInline(block.segments, block.text)}</p>`;
}

function renderFullArticle(article) {
  return (article?.content || []).map((block) => (
    renderArticleBlock(block, article?.faqs || [])
  )).join("");
}

function qualityScore(report) {
  const checks = Object.values(report?.checks || {});
  return checks.length
    ? Math.round((checks.filter(Boolean).length / checks.length) * 100)
    : null;
}

function actionToken(draft, action) {
  const expiry = draft.reviewExpiresAt?.toMillis?.()
    || draft.reviewExpiresAt?.getTime?.()
    || Number(draft.reviewExpiresAt);
  return signReviewToken({
    draftId: draft.draftId,
    slug: draft.article.slug,
    action,
    expiresAt: expiry,
  }, reviewSecret());
}

function eventId(articleId, versionId, revision) {
  return crypto
    .createHash("sha256")
    .update(`${articleId}:${versionId}:${revision}`)
    .digest("hex");
}

function safeRevision(value, resend) {
  if (!resend) return PACKAGE_REVISION;
  const revision = String(value || "").trim();
  if (!/^resend-[a-zA-Z0-9_-]{8,80}$/.test(revision)) {
    const error = new Error("A stable resend revision is required.");
    error.code = "seo/invalid-review-package-revision";
    throw error;
  }
  return revision;
}

function messageFor({
  draft,
  articleData,
  image,
  revision,
  resend,
}) {
  const { article, sources, claims, qualityReport, editorial, metrics, version } = articleData;
  if (
    image?.qa?.passed !== true
    || !image?.pngBase64
    || !image?.mobilePngBase64
  ) {
    const error = new Error("Only an approved hero can be included in a finished review package.");
    error.code = "seo/hero-not-approved";
    throw error;
  }
  const tokens = Object.fromEntries(
    ["approve", "request_changes", "reject"].map((action) => [
      action,
      actionToken(draft, action),
    ]),
  );
  const actionUrl = (action) => `${siteUrl()}/seo/review?token=${encodeURIComponent(tokens[action])}`;
  const previewUrl = `${siteUrl()}/admin/seo-articles/${encodeURIComponent(draft.draftId)}/preview`;
  const sourcesHtml = sources.map((source) => (
    `<li><a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a> — ${escapeHtml(source.publisher)}; claims ${escapeHtml((source.claimIds || []).join(", "))}</li>`
  )).join("");
  const qualityHtml = Object.entries(qualityReport?.checks || {}).map(([name, passed]) => (
    `<li>${escapeHtml(name)}: <strong>${passed ? "PASS" : "FAIL"}</strong></li>`
  )).join("");
  const editorialRecommendation = editorial.recommendation || "Not available";
  const seoScore = qualityScore(qualityReport);
  const heroScore = image.qa.visionScore;
  const primaryKeyword = article.keywords?.[0] || "Not recorded";
  return {
    tokens,
    email: {
      to: draft.reviewerEmail,
      senderType: "seo_review",
      subject: resend
        ? "Resent: Finished article ready for final review"
        : "Finished article ready for final review",
      idempotencyKey: `seo-finished-review-${draft.draftId}-${version.id}-${revision}`,
      attachments: [{
        filename: `${article.slug}-hero.png`,
        content: image.pngBase64,
        contentId: "cleartill-finished-hero",
      }, {
        filename: `${article.slug}-hero-mobile.png`,
        content: image.mobilePngBase64,
      }],
      html: `<main style="font-family:Arial,sans-serif;color:#143c3a;max-width:760px;margin:auto;line-height:1.6">
        <p style="color:#278a68;font-weight:800">${resend ? "RESENT · " : ""}CLEARTILL JOURNAL FINAL REVIEW</p>
        <img src="cid:cleartill-finished-hero" alt="${escapeHtml(image.alt || article.description)}" width="720" style="display:block;max-width:100%;height:auto;border-radius:16px;margin-bottom:24px" />
        <h1>${escapeHtml(article.title)}</h1>
        <table style="border-collapse:collapse;width:100%;margin:20px 0">
          <tbody>
            <tr><th style="text-align:left;padding:6px">Primary keyword</th><td>${escapeHtml(primaryKeyword)}</td></tr>
            <tr><th style="text-align:left;padding:6px">SEO score</th><td>${escapeHtml(seoScore ?? "Not recorded")}${seoScore === null ? "" : "/100"}</td></tr>
            <tr><th style="text-align:left;padding:6px">Hero score</th><td>${escapeHtml(heroScore)}/100</td></tr>
            <tr><th style="text-align:left;padding:6px">Reading time</th><td>${escapeHtml(metrics.readingMinutes || "Not recorded")} min</td></tr>
            <tr><th style="text-align:left;padding:6px">Word count</th><td>${escapeHtml(metrics.wordCount)}</td></tr>
            <tr><th style="text-align:left;padding:6px">Sources</th><td>${escapeHtml(metrics.sourceCount)}</td></tr>
            <tr><th style="text-align:left;padding:6px">Internal links</th><td>${escapeHtml(metrics.internalLinkCount)}</td></tr>
            <tr><th style="text-align:left;padding:6px">CTA</th><td>${escapeHtml(metrics.ctaDestination)}</td></tr>
            <tr><th style="text-align:left;padding:6px">Editorial recommendation</th><td>${escapeHtml(editorialRecommendation)}</td></tr>
          </tbody>
        </table>
        <p><a href="${escapeHtml(previewUrl)}" style="display:inline-block;background:#37c48e;color:#143c3a;padding:13px 18px;border-radius:8px;text-decoration:none;font-weight:800">Open full article</a></p>
        <hr style="border:0;border-top:1px solid #d7e1dc;margin:28px 0" />
        ${renderFullArticle(article)}
        <aside style="padding:16px;background:#f8f5ee;border-radius:10px"><strong>Good to know</strong><p>${escapeHtml(article.disclaimer || "This guide is general information, not personalised financial advice.")}</p></aside>
        <h2>Sources and claims</h2>
        <p>${escapeHtml(claims.length)} claim record${claims.length === 1 ? "" : "s"} attached.</p>
        <ol>${sourcesHtml}</ol>
        <h2>Quality results</h2><ul>${qualityHtml}</ul>
        <p>
          <a href="${escapeHtml(actionUrl("approve"))}" style="display:inline-block;background:#143c3a;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;margin:4px">Approve</a>
          <a href="${escapeHtml(actionUrl("request_changes"))}" style="display:inline-block;background:#e5a83b;color:#143c3a;padding:12px 18px;border-radius:8px;text-decoration:none;margin:4px">Request changes</a>
          <a href="${escapeHtml(actionUrl("reject"))}" style="display:inline-block;background:#9b3d35;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;margin:4px">Reject</a>
        </p>
        <p style="font-size:13px;color:#59625d">Buttons open a review page. GET never records a decision. This package does not publish the article.</p>
      </main>`,
    },
  };
}

export async function sendFinishedArticleReviewPackage({
  articleId,
  revision,
  resend = false,
  now = new Date(),
} = {}) {
  const id = String(articleId || "").trim();
  if (!id) throw new Error("Article ID is required.");
  const articleData = await getSeoAdminArticle(id);
  const selectedRevision = safeRevision(revision, resend);
  const db = getAdminDb();
  const eventRef = db.collection(EVENTS_COLLECTION).doc(
    eventId(id, articleData.version.id, selectedRevision),
  );
  const stateRef = db.collection(STATE_COLLECTION).doc(id);
  const draftRef = db.collection("seoArticleDrafts").doc(id);
  const imageRef = db.collection("seoArticleDraftImages").doc(id);
  const exportRef = db.collection("seoArticleExports").doc(id);
  const leaseId = crypto.randomUUID();
  const claim = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(eventRef);
    const current = snapshot.exists ? snapshot.data() : null;
    if (current?.status === "sent") return { claimed: false, record: current };
    if (
      current?.status === "sending"
      && (current?.leaseExpiresAt?.toMillis?.() || 0) > now.getTime()
    ) return { claimed: false, record: current };
    transaction.set(eventRef, {
      articleId: id,
      versionId: articleData.version.id,
      revision: selectedRevision,
      resend,
      status: "sending",
      leaseId,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      attempts: Number(current?.attempts || 0) + 1,
      createdAt: current?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { claimed: true };
  });
  if (!claim.claimed) {
    return {
      ok: true,
      articleId: id,
      versionId: articleData.version.id,
      revision: selectedRevision,
      duplicatePrevented: true,
      sent: claim.record?.status === "sent",
      providerMessageId: claim.record?.providerMessageId || null,
      published: false,
    };
  }

  const [draftSnapshot, imageSnapshot, exportSnapshot] = await Promise.all([
    draftRef.get(),
    imageRef.get(),
    exportRef.get(),
  ]);
  const draft = draftSnapshot.data();
  const image = exportSnapshot.data()?.heroImage || imageSnapshot.data();
  try {
    const rendered = messageFor({
      draft,
      articleData,
      image,
      revision: selectedRevision,
      resend,
    });
    const delivery = await sendEmail(rendered.email);
    await db.runTransaction(async (transaction) => {
      const fresh = await transaction.get(eventRef);
      if (fresh.data()?.leaseId !== leaseId) throw new Error("Review package lease expired.");
      transaction.update(eventRef, {
        status: "sent",
        providerMessageId: delivery.providerId || null,
        sentAt: FieldValue.serverTimestamp(),
        leaseId: FieldValue.delete(),
        leaseExpiresAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(stateRef, {
        articleId: id,
        versionId: articleData.version.id,
        lastStatus: "sent",
        lastRevision: selectedRevision,
        providerMessageId: delivery.providerId || null,
        lastSentAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(db.collection(METRICS_COLLECTION).doc("aggregate"), {
        reviewEmailsSent: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    return {
      ok: true,
      articleId: id,
      versionId: articleData.version.id,
      revision: selectedRevision,
      duplicatePrevented: false,
      sent: true,
      providerMessageId: delivery.providerId || null,
      recipient: draft.reviewerEmail,
      published: false,
    };
  } catch (error) {
    await db.runTransaction(async (transaction) => {
      transaction.update(eventRef, {
        status: "failed",
        errorCode: error?.code || "seo/review-package-failed",
        error: String(error?.message || "Review package failed.").slice(0, 300),
        leaseId: FieldValue.delete(),
        leaseExpiresAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(stateRef, {
        articleId: id,
        versionId: articleData.version.id,
        lastStatus: "failed",
        lastRevision: selectedRevision,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(db.collection(METRICS_COLLECTION).doc("aggregate"), {
        reviewEmailFailures: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    throw error;
  }
}

export { PACKAGE_REVISION };
