import crypto from "node:crypto";
import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import { sendEmail } from "@/lib/email/emailService.server";
import {
  createCanvaDesign,
  exportCanvaDesign,
  getCanvaStatus,
  listCanvaBrandTemplates,
  resizeCanvaDesign,
} from "@/lib/integrations/canva.server";
import articleCore from "@/lib/seoArticles/articleCore.cjs";
import generationCore from "@/lib/seoArticles/articleGeneration.cjs";
import nativeHero from "@/lib/seoArticles/nativeHero.cjs";
import heroQuality from "@/lib/seoArticles/heroQuality.cjs";
import workflowCore from "@/lib/seoArticles/workflowCore.cjs";
import runtimeConfig from "@/lib/seoArticles/runtimeConfig.cjs";
import {
  generateSeoHeroTitle,
  generateStructuredSeoArticle,
  reviewSeoHeroVision,
} from "@/lib/seoArticles/openai.server";

const {
  REVIEW_TTL_MS,
  buildCanvaFallbackPlan,
  normalizeCapabilitySnapshot,
  signReviewToken,
  tokenDigest,
  verifyReviewToken,
} = articleCore;
const { runDeterministicQualityGates } = generationCore;
const { generateNativeHero } = nativeHero;
const { generateHeroWithQualityGate } = heroQuality;
const { dailyRunId, publicationBoundary, shouldGenerateDailyRun, shouldSendReviewEmail } = workflowCore;

const COLLECTIONS = {
  runs: "seoArticleRuns",
  drafts: "seoArticleDrafts",
  images: "seoArticleDraftImages",
  exports: "seoArticleExports",
  heroReprocessRuns: "seoArticleHeroReprocessRuns",
};
const LEASE_MS = 10 * 60 * 1000;
const HERO_REPROCESS_REVISION = "image-quality-gate-v7";

function reviewSecret() {
  const secret = String(process.env.SEO_REVIEW_TOKEN_SECRET || "").trim();
  if (!secret) throw new Error("SEO_REVIEW_TOKEN_SECRET is not configured.");
  return secret;
}

function siteUrl() {
  return String(process.env.NEXT_PUBLIC_SITE_URL || "https://www.cleartill.money").replace(/\/+$/, "");
}

function dateKeyInLondon(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function qualityScore(report) {
  const checks = Object.values(report?.checks || {});
  const passed = checks.filter(Boolean).length;
  return {
    passed,
    total: checks.length,
    percent: checks.length ? Math.round((passed / checks.length) * 100) : 0,
  };
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

async function safeCapabilitySnapshot(uid) {
  const checkedAt = new Date().toISOString();
  if (!uid) {
    return normalizeCapabilitySnapshot({
      connected: false,
      errorCode: "canva/owner-not-configured",
    }, checkedAt);
  }
  try {
    return normalizeCapabilitySnapshot(await getCanvaStatus(uid), checkedAt);
  } catch (error) {
    return normalizeCapabilitySnapshot({
      connected: false,
      errorCode: error?.code || "canva/unavailable",
    }, checkedAt);
  }
}

function renderArticleHtml(article) {
  return (article.content || []).map((block) => {
    if (block.type === "heading") return `<h2>${escapeHtml(block.text)}</h2>`;
    if (block.type === "list") {
      return `<ul>${(block.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    }
    return `<p>${escapeHtml(block.text)}</p>`;
  }).join("");
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

async function renderReviewEmail(draft, image) {
  const actions = ["approve", "request_changes", "reject"];
  const tokens = Object.fromEntries(actions.map((action) => [action, actionToken(draft, action)]));
  const links = Object.fromEntries(actions.map((action) => [
    action,
    `${siteUrl()}/seo/review?token=${encodeURIComponent(tokens[action])}`,
  ]));
  const sources = draft.sources.map((source) => (
    `<li><a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a> — ${escapeHtml(source.publisher)}; supports ${escapeHtml(source.claimIds.join(", "))}</li>`
  )).join("");
  const quality = Object.entries(draft.qualityReport.checks).map(([name, passed]) => (
    `<li>${escapeHtml(name)}: <strong>${passed ? "PASS" : "FAIL"}</strong></li>`
  )).join("");
  const imageQa = image?.qa || draft.imageQa || {};
  const imageIssues = (imageQa.issues || []).map((issue) => (
    `<li><strong>${escapeHtml(issue.severity)}</strong> — ${escapeHtml(issue.message)}</li>`
  )).join("");
  const approvedImage = imageQa.passed === true && image?.pngBase64 && image?.svg;
  const imageMarkup = approvedImage
    ? `<img src="cid:cleartill-seo-hero" alt="${escapeHtml(image.alt)}" width="720" style="max-width:100%;height:auto;border-radius:16px" />`
    : `<div style="padding:16px;border:2px solid #e5a83b;border-radius:12px;background:#fff8e8">
        <strong>Image review required.</strong> The article is ready for review, but no hero image is attached because automated image QA did not pass.
      </div>`;
  const attachments = approvedImage ? [{
    filename: `${draft.article.slug}-hero.png`,
    content: image.pngBase64,
    contentId: "cleartill-seo-hero",
  }, {
    filename: `${draft.article.slug}-hero.svg`,
    content: Buffer.from(image.svg).toString("base64"),
  }, {
    filename: `${draft.article.slug}-hero-mobile.png`,
    content: image.mobilePngBase64,
  }] : [];
  return {
    tokens,
    message: {
      to: draft.reviewerEmail,
      senderType: "seo_review",
      subject: `SEO review: ${draft.article.title}`,
      idempotencyKey: `seo-review-${draft.runId}`,
      ...(attachments.length ? { attachments } : {}),
      html: `<main style="font-family:Arial,sans-serif;color:#143c3a;max-width:760px">
        <p style="color:#278a68;font-weight:700">CLEARTILL JOURNAL REVIEW</p>
        <h1>${escapeHtml(draft.article.title)}</h1>
        ${imageMarkup}
        <p><strong>${escapeHtml(draft.article.description)}</strong></p>
        ${renderArticleHtml(draft.article)}
        <h2>Sources and material claims</h2><ol>${sources}</ol>
        <h2>Deterministic quality report</h2><ul>${quality}</ul>
        <h2>Hero image QA</h2>
        <p><strong>${imageQa.passed ? "PASS" : "REVIEW REQUIRED"}</strong> · score ${escapeHtml(imageQa.visionScore ?? 0)}/100 · attempt ${escapeHtml(imageQa.attemptCount ?? 0)} · layout ${escapeHtml(imageQa.finalLayoutVariant || "none")} · model ${escapeHtml(imageQa.model || "unavailable")}</p>
        ${imageIssues ? `<ul>${imageIssues}</ul>` : "<p>No image issues reported.</p>"}
        <p>
          <a href="${escapeHtml(links.approve)}" style="display:inline-block;background:#143c3a;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;margin:4px">Review and approve</a>
          <a href="${escapeHtml(links.request_changes)}" style="display:inline-block;background:#e5a83b;color:#143c3a;padding:12px 18px;border-radius:8px;text-decoration:none;margin:4px">Request changes</a>
          <a href="${escapeHtml(links.reject)}" style="display:inline-block;background:#9b3d35;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;margin:4px">Reject</a>
        </p>
        <p style="font-size:13px;color:#59625d">Links open a review page. No GET request performs an action. Approval creates an export and does not publish.</p>
      </main>`,
    },
  };
}

function previousHeroStatus(image) {
  if (!image) return "missing";
  if (image.qa?.passed === true) return "qa_passed";
  if (image.imageReviewRequired === true) return "review_required";
  if (image.pngBase64 || image.svg) return "legacy_unreviewed";
  return "missing";
}

function renderHeroRereviewEmail({
  draft,
  oldHeroStatus,
  hero,
  qa,
  deterministicPassed,
  idempotencyKey,
}) {
  const approvedImage = qa?.passed === true && hero?.png && hero?.mobilePng;
  const issues = (qa?.issues || []).map((issue) => (
    `<li><strong>${escapeHtml(issue.severity)}</strong> — ${escapeHtml(issue.message)}</li>`
  )).join("");
  return {
    to: draft.reviewerEmail,
    senderType: "seo_review",
    subject: `Corrected hero image ready for review: ${draft.article.title}`,
    idempotencyKey,
    ...(approvedImage ? {
      attachments: [{
        filename: `${draft.article.slug}-hero.png`,
        content: hero.png.toString("base64"),
        contentId: "cleartill-rereview-master",
      }, {
        filename: `${draft.article.slug}-hero-mobile.png`,
        content: hero.mobilePng.toString("base64"),
        contentId: "cleartill-rereview-mobile",
      }],
    } : {}),
    html: `<main style="font-family:Arial,sans-serif;color:#143c3a;max-width:760px">
      <p style="color:#278a68;font-weight:700">CORRECTED HERO IMAGE READY FOR REVIEW</p>
      ${approvedImage ? `
        <img src="cid:cleartill-rereview-master" alt="${escapeHtml(hero.alt)}" width="720" style="max-width:100%;height:auto;border-radius:16px" />
      ` : ""}
      <h1>${escapeHtml(draft.article.title)}</h1>
      <dl>
        <dt>Old hero status</dt><dd>${escapeHtml(oldHeroStatus)}</dd>
        <dt>New hero title</dt><dd>${escapeHtml(hero?.heroTitle || draft.heroTitle || "Unavailable")}</dd>
        <dt>Layout variant</dt><dd>${escapeHtml(qa?.finalLayoutVariant || "none")}</dd>
        <dt>Resolved font</dt><dd>${escapeHtml(hero?.diagnostics?.resolvedFontFamily || "Unavailable")}</dd>
        <dt>Deterministic QA</dt><dd>${deterministicPassed ? "PASS" : "FAIL"}</dd>
        <dt>Vision score</dt><dd>${escapeHtml(qa?.visionScore ?? 0)}/100</dd>
        <dt>Attempt count</dt><dd>${escapeHtml(qa?.attemptCount ?? 0)}</dd>
      </dl>
      ${approvedImage ? `
        <h2>390px mobile preview</h2>
        <img src="cid:cleartill-rereview-mobile" alt="${escapeHtml(hero.alt)}" width="390" style="max-width:100%;height:auto;border-radius:12px" />
      ` : `<p><strong>No image attached.</strong> The replacement did not pass production image QA.</p>`}
      <h2>Issues found</h2>
      ${issues ? `<ul>${issues}</ul>` : "<p>No issues reported.</p>"}
      <p>This re-review does not publish the article and does not change its existing approval history.</p>
    </main>`,
  };
}

async function claimDailyGeneration(db, runRef, dateKey, now) {
  const leaseId = crypto.randomUUID();
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(runRef);
    const current = snapshot.exists ? snapshot.data() : null;
    const normalized = current ? {
      ...current,
      leaseExpiresAtMs: current.leaseExpiresAt?.toMillis?.() || 0,
    } : null;
    if (!shouldGenerateDailyRun(normalized, now.getTime())) {
      return { claimed: false, record: current };
    }
    transaction.set(runRef, {
      dateKey,
      runId: dailyRunId(dateKey),
      status: "generating",
      leaseId,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      attempts: Number(current?.attempts || 0) + 1,
      createdAt: current?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { claimed: true, leaseId };
  });
}

async function claimReviewEmail(db, runRef, now) {
  const emailLeaseId = crypto.randomUUID();
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(runRef);
    if (!snapshot.exists) return { claimed: false };
    const current = snapshot.data();
    if (!shouldSendReviewEmail({
      ...current,
      emailLeaseExpiresAtMs: current.emailLeaseExpiresAt?.toMillis?.() || 0,
    }, now.getTime())) {
      return { claimed: false, record: current };
    }
    transaction.update(runRef, {
      status: "email_sending",
      emailStatus: "sending",
      emailLeaseId,
      emailLeaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { claimed: true, emailLeaseId, record: current };
  });
}

async function deliverReviewEmail(db, runRef, draftRef, imageRef, now) {
  const claim = await claimReviewEmail(db, runRef, now);
  if (!claim.claimed) {
    return { sent: claim.record?.emailStatus === "sent", duplicatePrevented: true };
  }
  const [draftSnapshot, imageSnapshot] = await Promise.all([draftRef.get(), imageRef.get()]);
  const draft = draftSnapshot.data();
  const image = imageSnapshot.data();
  const rendered = await renderReviewEmail(draft, image);
  try {
    const delivery = await sendEmail(rendered.message);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(runRef);
      if (snapshot.data()?.emailLeaseId !== claim.emailLeaseId) return;
      transaction.update(runRef, {
        status: "email_sent",
        emailStatus: "sent",
        emailProviderId: delivery.providerId || null,
        emailSentAt: FieldValue.serverTimestamp(),
        emailLeaseId: FieldValue.delete(),
        emailLeaseExpiresAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(draftRef, {
        status: "in_review",
        actionTokenHashes: Object.fromEntries(
          Object.entries(rendered.tokens).map(([action, token]) => [action, tokenDigest(token)]),
        ),
        reviewEmailSentAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return { sent: true, duplicatePrevented: false };
  } catch (error) {
    await runRef.update({
      status: "email_pending",
      emailStatus: "pending",
      emailError: String(error?.message || "Email delivery failed.").slice(0, 300),
      emailLeaseId: FieldValue.delete(),
      emailLeaseExpiresAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    throw error;
  }
}

export async function runScheduledSeoArticle({
  now = new Date(),
  topic,
  generate = generateStructuredSeoArticle,
} = {}) {
  const config = runtimeConfig.requireSeoArticleRuntimeConfig();
  const reviewerEmail = config.reviewerEmail;
  const dateKey = dateKeyInLondon(now);
  const runId = dailyRunId(dateKey);
  const db = getAdminDb();
  const runRef = db.collection(COLLECTIONS.runs).doc(runId);
  const claim = await claimDailyGeneration(db, runRef, dateKey, now);
  let draftRef;
  let imageRef;

  if (claim.claimed) {
    try {
      const generated = await generate({ dateKey, topic });
      const qualityReport = runDeterministicQualityGates(generated, { contentId: runId });
      if (!qualityReport.passed) {
        await runRef.update({
          status: "quality_failed",
          qualityReport,
          leaseId: FieldValue.delete(),
          leaseExpiresAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { ok: false, runId, status: "quality_failed", qualityReport };
      }
      const heroResult = await generateHeroWithQualityGate({
        article: generated.article,
        heroTitle: generated.heroTitle,
        altText: generated.heroAltText,
        render: generateNativeHero,
        reviewVision: reviewSeoHeroVision,
      });
      const hero = heroResult.hero;
      const ownerUid = String(process.env.SEO_CANVA_OWNER_UID || "").trim();
      const capabilityStatus = await safeCapabilitySnapshot(ownerUid);
      const canvaPlan = buildCanvaFallbackPlan(capabilityStatus);
      const draftId = crypto.randomUUID();
      const reviewExpiresAt = new Date(now.getTime() + REVIEW_TTL_MS);
      draftRef = db.collection(COLLECTIONS.drafts).doc(draftId);
      imageRef = db.collection(COLLECTIONS.images).doc(draftId);
      await db.runTransaction(async (transaction) => {
        const freshRun = await transaction.get(runRef);
        if (freshRun.data()?.leaseId !== claim.leaseId) {
          throw new Error("The daily generation lease expired.");
        }
        transaction.create(draftRef, {
          draftId,
          runId,
          dateKey,
          status: "email_pending",
          reviewerEmail,
          article: generated.article,
          heroTitle: generated.heroTitle,
          claims: generated.claims,
          sources: generated.sources,
          generation: generated.generation,
          qualityReport,
          imageQa: heroResult.qa,
          imageReviewRequired: heroResult.imageReviewRequired,
          capabilityStatus,
          canvaPlan,
          reviewExpiresAt,
          publication: { exportReady: false, published: false },
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.create(imageRef, {
          draftId,
          source: "cleartill_native",
          imageReviewRequired: heroResult.imageReviewRequired,
          qa: heroResult.qa,
          ...(hero ? {
            mediaType: hero.mediaType,
            width: hero.width,
            height: hero.height,
            mobileWidth: hero.mobileWidth,
            mobileHeight: hero.mobileHeight,
            alt: hero.alt,
            heroTitle: hero.heroTitle,
            layoutVariant: hero.layoutVariant,
            layoutValidation: hero.layoutValidation,
            svg: hero.svg,
            pngBase64: hero.png.toString("base64"),
            mobilePngBase64: hero.mobilePng.toString("base64"),
          } : {
            mediaType: null,
            width: null,
            height: null,
            mobileWidth: null,
            mobileHeight: null,
          }),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.update(runRef, {
          status: "email_pending",
          emailStatus: "pending",
          draftId,
          slug: generated.article.slug,
          capabilityStatus,
          qualityReport,
          leaseId: FieldValue.delete(),
          leaseExpiresAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
    } catch (error) {
      await runRef.update({
        status: "failed",
        errorCode: error?.code || "seo/generation-failed",
        error: String(error?.message || "Generation failed.").slice(0, 500),
        leaseId: FieldValue.delete(),
        leaseExpiresAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      throw error;
    }
  } else {
    const current = claim.record || (await runRef.get()).data();
    if (!current?.draftId) {
      return { ok: true, runId, status: current?.status || "generating", duplicatePrevented: true };
    }
    draftRef = db.collection(COLLECTIONS.drafts).doc(current.draftId);
    imageRef = db.collection(COLLECTIONS.images).doc(current.draftId);
  }

  const email = await deliverReviewEmail(db, runRef, draftRef, imageRef, now);
  const finalRun = (await runRef.get()).data();
  const [finalDraft, finalImage, exportSnapshot] = await Promise.all([
    draftRef.get(),
    imageRef.get(),
    db.collection(COLLECTIONS.exports).doc(finalRun.draftId).get(),
  ]);
  const draft = finalDraft.data();
  const image = finalImage.data();
  return {
    ok: true,
    runId,
    draftId: finalRun.draftId,
    status: finalRun.status,
    generated: claim.claimed,
    email,
    report: {
      articleDocumentId: finalRun.draftId,
      topic: draft?.generation?.topic || null,
      title: draft?.article?.title || null,
      qualityScore: qualityScore(draft?.qualityReport),
      sourceCount: Array.isArray(draft?.sources) ? draft.sources.length : 0,
      hero: {
        generated: Boolean(image?.pngBase64 && image?.svg),
        formats: image?.pngBase64 && image?.svg ? ["png", "svg", "mobile_png"] : [],
        width: image?.width || null,
        height: image?.height || null,
        mobileWidth: image?.mobileWidth || null,
        mobileHeight: image?.mobileHeight || null,
        imageReviewRequired: draft?.imageReviewRequired === true,
        qa: image?.qa || draft?.imageQa || null,
      },
      resendMessageId: finalRun.emailProviderId || null,
      reviewEmailRecipient: draft?.reviewerEmail || null,
      approvalCreatedUnpublishedExport: exportSnapshot.exists
        && exportSnapshot.data()?.publication?.published === false,
      published: false,
    },
  };
}

export async function reprocessSeoArticleHero({
  draftId,
  now = new Date(),
  generateTitle = generateSeoHeroTitle,
  render = generateNativeHero,
  reviewVision = reviewSeoHeroVision,
} = {}) {
  runtimeConfig.requireSeoArticleRuntimeConfig();
  const id = String(draftId || "").trim();
  if (!id) throw new Error("A draft ID is required for hero reprocessing.");
  const db = getAdminDb();
  const runId = `${id}-${HERO_REPROCESS_REVISION}`;
  const runRef = db.collection(COLLECTIONS.heroReprocessRuns).doc(runId);
  const leaseId = crypto.randomUUID();
  const claim = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(runRef);
    const current = snapshot.exists ? snapshot.data() : null;
    if (["sent", "skipped"].includes(current?.emailStatus)) {
      return { claimed: false, record: current };
    }
    const leaseExpiry = current?.leaseExpiresAt?.toMillis?.() || 0;
    if (current?.status === "processing" && leaseExpiry > now.getTime()) {
      return { claimed: false, record: current };
    }
    transaction.set(runRef, {
      runId,
      draftId: id,
      revision: HERO_REPROCESS_REVISION,
      status: "processing",
      emailStatus: current?.emailStatus || "pending",
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
      runId,
      draftId: id,
      duplicatePrevented: true,
      inProgress: !["sent", "skipped"].includes(claim.record?.emailStatus),
      report: claim.record?.report ? {
        ...claim.record.report,
        qa: claim.record.qa || null,
      } : null,
    };
  }

  try {
    const draftRef = db.collection(COLLECTIONS.drafts).doc(id);
    const imageRef = db.collection(COLLECTIONS.images).doc(id);
    const exportRef = db.collection(COLLECTIONS.exports).doc(id);
    const [draftSnapshot, imageSnapshot, exportSnapshot] = await Promise.all([
      draftRef.get(),
      imageRef.get(),
      exportRef.get(),
    ]);
    if (!draftSnapshot.exists) throw new Error("The requested SEO article draft does not exist.");
    const draft = draftSnapshot.data();
    const oldHeroStatus = previousHeroStatus(imageSnapshot.exists ? imageSnapshot.data() : null);
    const titleResult = await generateTitle({ article: draft.article });
    const heroResult = await generateHeroWithQualityGate({
      article: draft.article,
      heroTitle: titleResult.heroTitle,
      altText: imageSnapshot.data()?.alt || draft.article.description,
      render,
      reviewVision,
    });
    const hero = heroResult.hero;
    const qa = heroResult.qa;
    const deterministicPassed = qa?.deterministicPassed === true;
    const replacementImage = hero ? {
      draftId: id,
      source: "cleartill_native",
      mediaType: hero.mediaType,
      width: hero.width,
      height: hero.height,
      mobileWidth: hero.mobileWidth,
      mobileHeight: hero.mobileHeight,
      alt: hero.alt,
      heroTitle: hero.heroTitle,
      layoutVariant: hero.layoutVariant,
      layoutValidation: hero.layoutValidation,
      svg: hero.svg,
      pngBase64: hero.png.toString("base64"),
      mobilePngBase64: hero.mobilePng.toString("base64"),
      imageReviewRequired: false,
      qa,
      replacedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    } : null;
    const replacementAttachedToExport = Boolean(hero && exportSnapshot.exists);

    await db.runTransaction(async (transaction) => {
      const freshRun = await transaction.get(runRef);
      if (freshRun.data()?.leaseId !== leaseId) {
        throw new Error("The hero reprocessing lease expired.");
      }
      transaction.update(draftRef, {
        heroTitle: hero?.heroTitle || titleResult.heroTitle,
        imageQa: qa,
        imageReviewRequired: heroResult.imageReviewRequired,
        heroReprocessedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (replacementImage) {
        transaction.set(imageRef, {
          ...replacementImage,
          createdAt: imageSnapshot.exists
            ? imageSnapshot.data()?.createdAt || FieldValue.serverTimestamp()
            : FieldValue.serverTimestamp(),
        });
        if (exportSnapshot.exists) {
          transaction.update(exportRef, {
            heroImage: replacementImage,
            heroImageQa: qa,
            heroTitle: hero.heroTitle,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
      transaction.update(runRef, {
        status: "email_pending",
        oldHeroStatus,
        heroTitle: hero?.heroTitle || titleResult.heroTitle,
        titleModel: titleResult.model || null,
        qa,
        deterministicPassed,
        replacementAttachedToExport,
        imageReviewRequired: heroResult.imageReviewRequired,
        leaseId: FieldValue.delete(),
        leaseExpiresAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    const emailIdempotencyKey = `seo-hero-rereview-${id}-${HERO_REPROCESS_REVISION}`;
    const delivery = hero
      ? await sendEmail(renderHeroRereviewEmail({
        draft,
        oldHeroStatus,
        hero,
        qa,
        deterministicPassed,
        idempotencyKey: emailIdempotencyKey,
      }))
      : { providerId: null };
    const report = {
      finalHeroTitle: hero?.heroTitle || titleResult.heroTitle,
      layoutVariant: qa?.finalLayoutVariant || null,
      deterministicPassed,
      visionScore: qa?.visionScore ?? 0,
      attempts: qa?.attemptCount ?? 0,
      resendMessageId: delivery.providerId || null,
      replacementAttachedToExport,
      imageReviewRequired: heroResult.imageReviewRequired,
      published: false,
    };
    await runRef.update({
      status: "completed",
      emailStatus: hero ? "sent" : "skipped",
      emailProviderId: delivery.providerId || null,
      emailIdempotencyKey,
      ...(hero ? { emailSentAt: FieldValue.serverTimestamp() } : {}),
      report,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {
      ok: true,
      runId,
      draftId: id,
      duplicatePrevented: false,
      report,
    };
  } catch (error) {
    await runRef.update({
      status: "failed",
      errorCode: error?.code || "seo/hero-reprocess-failed",
      error: String(error?.message || "Hero reprocessing failed.").slice(0, 500),
      leaseId: FieldValue.delete(),
      leaseExpiresAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    throw error;
  }
}

async function readSignedReview(token) {
  const payload = verifyReviewToken(token, reviewSecret());
  const snapshot = await getAdminDb().collection(COLLECTIONS.drafts).doc(payload.draftId).get();
  const draft = snapshot.data();
  if (
    !snapshot.exists
    || draft.article?.slug !== payload.slug
    || !["approve", "request_changes", "reject"].includes(payload.action)
    || draft.actionTokenHashes?.[payload.action] !== tokenDigest(token)
  ) {
    throw new Error("This review action is invalid or has been replaced.");
  }
  return { payload, draft };
}

export async function getSeoArticleReview(token) {
  const { payload, draft } = await readSignedReview(token);
  const image = (await getAdminDb().collection(COLLECTIONS.images).doc(draft.draftId).get()).data();
  return {
    action: payload.action,
    draftId: draft.draftId,
    status: draft.status,
    article: draft.article,
    claims: draft.claims,
    sources: draft.sources,
    qualityReport: draft.qualityReport,
    heroDataUrl: image?.pngBase64 ? `data:image/png;base64,${image.pngBase64}` : null,
    imageQa: image?.qa || draft.imageQa || null,
    imageReviewRequired: draft.imageReviewRequired === true,
    boundary: publicationBoundary(payload.action),
  };
}

async function runOptionalCanvaAfterApproval(draft, exportRef) {
  const ownerUid = String(process.env.SEO_CANVA_OWNER_UID || "").trim();
  const capabilityStatus = await safeCapabilitySnapshot(ownerUid);
  const result = { capabilityStatus, status: capabilityStatus.available ? "available" : "unavailable", templates: [] };
  if (capabilityStatus.available && capabilityStatus.capabilities.brand_template) {
    const templates = await listCanvaBrandTemplates(ownerUid, { limit: 100 });
    result.templates = templates.items.map((item) => ({
      id: item.id,
      title: item.title || item.name || "Untitled template",
      thumbnailUrl: item.thumbnail?.url || item.thumbnail_url || null,
      viewUrl: item.view_url || null,
      createUrl: item.create_url || null,
    }));
    result.status = "templates_ready";
  }
  await exportRef.update({ canva: result, updatedAt: FieldValue.serverTimestamp() });
  return result;
}

export async function performSeoReviewAction({ token, note = "" }) {
  const { payload, draft } = await readSignedReview(token);
  const db = getAdminDb();
  const draftRef = db.collection(COLLECTIONS.drafts).doc(draft.draftId);
  const imageRef = db.collection(COLLECTIONS.images).doc(draft.draftId);
  const exportRef = db.collection(COLLECTIONS.exports).doc(draft.draftId);
  const status = payload.action === "approve"
    ? "approved"
    : payload.action === "request_changes"
      ? "changes_requested"
      : "rejected";

  await db.runTransaction(async (transaction) => {
    const [freshDraftSnapshot, imageSnapshot, existingExport] = await Promise.all([
      transaction.get(draftRef),
      transaction.get(imageRef),
      transaction.get(exportRef),
    ]);
    const fresh = freshDraftSnapshot.data();
    if (fresh?.status === status) return;
    if (fresh?.status !== "in_review") throw new Error("This draft has already been actioned.");
    if (payload.action === "approve") {
      transaction.set(exportRef, {
        schemaVersion: "journal-publication-export-v1",
        draftId: fresh.draftId,
        status: "publication_ready",
        article: fresh.article,
        claims: fresh.claims,
        sources: fresh.sources,
        qualityReport: fresh.qualityReport,
        heroImage: imageSnapshot.data(),
        publication: {
          exportReady: true,
          published: false,
          exportedToLiveCollection: false,
        },
        createdAt: existingExport.exists
          ? existingExport.data()?.createdAt || FieldValue.serverTimestamp()
          : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.update(draftRef, {
      status,
      reviewNote: String(note || "").trim().slice(0, 2000) || null,
      reviewedAt: FieldValue.serverTimestamp(),
      publication: {
        exportReady: payload.action === "approve",
        published: false,
      },
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  let canva = null;
  if (payload.action === "approve") {
    try {
      canva = await runOptionalCanvaAfterApproval(draft, exportRef);
    } catch (error) {
      canva = {
        status: "unavailable",
        errorCode: error?.code || "canva/post-approval-failed",
        error: "The export is ready; Canva is unavailable.",
      };
      await exportRef.update({ canva, updatedAt: FieldValue.serverTimestamp() });
    }
  }
  return {
    ok: true,
    action: payload.action,
    status,
    draftId: draft.draftId,
    publicationReady: payload.action === "approve",
    published: false,
    canva,
  };
}

export async function runSeoArticleCanvaAction(uid, draftId, action, input = {}) {
  const exportRef = getAdminDb().collection(COLLECTIONS.exports).doc(draftId);
  const snapshot = await exportRef.get();
  if (!snapshot.exists || snapshot.data()?.status !== "publication_ready") {
    throw new Error("Approve the article export before starting the optional Canva workflow.");
  }
  let result;
  if (action === "list_templates") {
    result = await listCanvaBrandTemplates(uid, { limit: input.limit, query: input.query });
  } else if (action === "create_from_template") {
    result = await createCanvaDesign(uid, {
      brandTemplateId: input.templateId,
      title: snapshot.data().article?.title,
    });
  } else if (action === "copy_design") {
    result = await createCanvaDesign(uid, {
      designId: input.designId,
      title: snapshot.data().article?.title,
    });
  } else if (action === "resize") {
    result = await resizeCanvaDesign(uid, input);
  } else if (action === "export") {
    result = await exportCanvaDesign(uid, input);
  } else {
    throw new Error("Unsupported Canva action.");
  }
  const design = result?.design || result?.job?.result?.design || result;
  const friendly = {
    action,
    result,
    editLink: design?.urls?.edit_url || design?.edit_url || null,
  };
  await exportRef.update({
    canvaLastAction: action,
    canvaLastResult: friendly,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return friendly;
}

export { dateKeyInLondon };
