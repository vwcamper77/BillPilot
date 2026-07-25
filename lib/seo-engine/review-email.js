import { Resend } from "resend";

import { createSeoReviewToken } from "./review-token";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderBlock(block) {
  if (!block) return "";
  if (block.type === "heading") return `<h2>${escapeHtml(block.text)}</h2>`;
  if (block.type === "paragraph") {
    const text = block.text || (block.segments || []).map((segment) => segment.text || "").join("");
    return `<p>${escapeHtml(text)}</p>`;
  }
  if (block.type === "quote") return `<blockquote>${escapeHtml(block.text)}</blockquote>`;
  if (block.type === "formula") return `<div><strong>${escapeHtml(block.label)}</strong><br>${escapeHtml(block.formula)}</div>`;
  if (block.type === "list" || block.type === "ordered-list") {
    const tag = block.type === "ordered-list" ? "ol" : "ul";
    const items = (block.items || []).map((item) => {
      const text = Array.isArray(item) ? item.map((part) => part.text || "").join("") : item;
      return `<li>${escapeHtml(text)}</li>`;
    }).join("");
    return `<${tag}>${items}</${tag}>`;
  }
  if (block.type === "result") {
    const text = (block.segments || []).map((segment) => segment.text || "").join("");
    return `<p><strong>${escapeHtml(text)}</strong></p>`;
  }
  return "";
}

function reviewUrl({ baseUrl, draftId, action }) {
  const token = createSeoReviewToken({ draftId, action });
  return `${baseUrl}/seo-review/${encodeURIComponent(draftId)}?action=${action}&token=${encodeURIComponent(token)}`;
}

export function buildSeoReviewEmail({ draftId, article, quality, citations = [], baseUrl }) {
  const approveUrl = reviewUrl({ baseUrl, draftId, action: "approve" });
  const changesUrl = reviewUrl({ baseUrl, draftId, action: "changes" });
  const rejectUrl = reviewUrl({ baseUrl, draftId, action: "reject" });
  const articleHtml = (article.content || []).map(renderBlock).join("\n");
  const sourceHtml = citations.length
    ? `<h2>Sources</h2><ul>${citations.map((source) => `<li>${escapeHtml(source.publisher || source.title)} — ${escapeHtml(source.title)}</li>`).join("")}</ul>`
    : "<p><strong>No source records supplied.</strong></p>";

  return {
    subject: `ClearTill article approval: ${article.title}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;color:#17202a;line-height:1.6">
        <p>I hope this email finds you well.</p>
        <p>A ClearTill Journal article is ready for your approval.</p>
        <div style="background:#f4f6f7;padding:16px;border-radius:10px;margin:20px 0">
          <strong>Quality score:</strong> ${escapeHtml(quality?.score ?? "Not scored")}<br>
          <strong>Slug:</strong> ${escapeHtml(article.slug)}<br>
          <strong>Reading time:</strong> ${escapeHtml(article.readingMinutes || "—")} minutes
        </div>
        <h1>${escapeHtml(article.title)}</h1>
        <p><em>${escapeHtml(article.description)}</em></p>
        ${articleHtml}
        ${sourceHtml}
        <div style="margin:32px 0;padding-top:24px;border-top:1px solid #d5d8dc">
          <a href="${approveUrl}" style="display:inline-block;background:#16794b;color:white;text-decoration:none;padding:12px 18px;border-radius:8px;margin:0 8px 8px 0">Review and approve</a>
          <a href="${changesUrl}" style="display:inline-block;background:#6c757d;color:white;text-decoration:none;padding:12px 18px;border-radius:8px;margin:0 8px 8px 0">Request changes</a>
          <a href="${rejectUrl}" style="display:inline-block;background:#a93226;color:white;text-decoration:none;padding:12px 18px;border-radius:8px;margin:0 8px 8px 0">Reject</a>
        </div>
        <p style="font-size:13px;color:#626567">For security, these links open a confirmation page. Opening the email or a link scanner will not approve or reject the article.</p>
      </div>
    `,
  };
}

export async function sendSeoReviewEmail({ draftId, article, quality, citations = [] }, env = process.env) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const to = String(env.SEO_REVIEW_EMAIL_TO || "").trim();
  const from = String(env.SEO_REVIEW_EMAIL_FROM || env.EMAIL_FROM || "ClearTill <hello@cleartill.money>").trim();
  const baseUrl = String(env.NEXT_PUBLIC_SITE_URL || "https://www.cleartill.money").replace(/\/$/, "");
  if (!apiKey || !to) throw new Error("RESEND_API_KEY and SEO_REVIEW_EMAIL_TO are required.");

  const resend = new Resend(apiKey);
  const email = buildSeoReviewEmail({ draftId, article, quality, citations, baseUrl });
  const result = await resend.emails.send({ from, to, subject: email.subject, html: email.html });
  if (result.error) throw new Error(result.error.message || "Resend failed to send SEO review email.");
  return { id: result.data?.id || null };
}
