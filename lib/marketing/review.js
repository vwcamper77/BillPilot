"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { MARKETING_ROOT, getContentById, validateContentRecord } = require("./content");
const { validateJournalDraft } = require("./JournalDraftAdapter");

const DEFAULT_IDS = ["ct-w01-a01", "ct-w01-b01", "ct-w01-c01"];
const REVIEW_ROOT = path.join(MARKETING_ROOT, "review/generated");
const REGISTRY_PATH = path.join(MARKETING_ROOT, "creative/canva-template-registry.json");
const PHOTO_BRIEFS_PATH = path.join(MARKETING_ROOT, "creative/stock-photo-briefs.json");
const PHOTO_CANDIDATES_PATH = path.join(MARKETING_ROOT, "creative/stock-photo-candidates.json");
const PHOTO_SELECTIONS_PATH = path.join(MARKETING_ROOT, "creative/stock-photo-selections.json");
const INFOGRAPHIC_MANIFEST_PATH = path.join(MARKETING_ROOT, "creative/infographic-manifest.json");
const ASSET_REGISTER_PATH = path.join(MARKETING_ROOT, "assets/asset-register.json");
const JOURNAL_DRAFT_ROOT = path.join(MARKETING_ROOT, "drafts/journal");
const LIVE_JOURNAL_PATH = path.resolve(MARKETING_ROOT, "../app/blog/posts.js");
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /Authorization:\s*Bearer\s+[A-Za-z0-9._~-]+/i,
  /\bBUFFER_API_KEY\s*=/i,
  /\bPIXABAY_API_KEY\s*=/i,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]+/i,
];

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function safeHref(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.startsWith("/")) return `https://www.cleartill.money${text}`;
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : "";
  } catch { return ""; }
}
function link(value, label = value) {
  const href = safeHref(value);
  return href ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>` : `<span class="missing">${escapeHtml(label || "Not registered")}</span>`;
}
function flattenStrings(value, result = []) {
  if (typeof value === "string") result.push(value);
  else if (Array.isArray(value)) value.forEach((item) => flattenStrings(item, result));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => flattenStrings(item, result));
  return result;
}
function journalDrafts() {
  return fs.readdirSync(JOURNAL_DRAFT_ROOT).filter((name) => name.endsWith(".json")).map((name) => {
    const file = path.join(JOURNAL_DRAFT_ROOT, name);
    return { file, relativePath: path.relative(path.resolve(MARKETING_ROOT, ".."), file), record: readJson(file) };
  });
}

function validateTemplateRegistry(registry) {
  const errors = [];
  if (registry?.canonicalFolder?.url !== "https://www.canva.com/folder/FAHP8Xz8OL4") errors.push("Canonical Canva folder URL is missing or incorrect.");
  const keys = new Set();
  for (const template of registry?.templates || []) {
    if (!template.key || keys.has(template.key)) errors.push(`Invalid or duplicate Canva template key: ${template.key || "missing"}.`);
    keys.add(template.key);
    if (!["autofill", "native_copy", "manual"].includes(template.automationMode)) errors.push(`Unsupported automation mode for ${template.key}.`);
    if (template.automationMode === "autofill" && (!template.canvaBrandTemplateId || template.autofillFieldsVerified !== true || !template.requiredFields?.length)) errors.push(`Autofill template ${template.key} lacks a verified BTM ID or fields.`);
    if (template.automationMode === "native_copy" && !template.canvaDesignId) errors.push(`Native-copy template ${template.key} requires a Canva design ID.`);
    if (template.automationMode === "manual" && !template.manualChangesRequired?.length) errors.push(`Manual template ${template.key} requires a production checklist.`);
  }
  for (const [contentId, templateKeys] of Object.entries(registry?.campaignMappings || {})) {
    for (const key of templateKeys) if (!keys.has(key)) errors.push(`${contentId} references unknown Canva template ${key}.`);
  }
  return { valid: errors.length === 0, errors };
}

function validateCampaignAFigures(campaign, journal) {
  const errors = [];
  const expected = { start: 1250, deduction: 1015, result: 235 };
  const campaignCalculation = campaign?.illustrativeCalculations?.[0];
  const journalCalculation = journal?.illustrativeCalculations?.[0];
  for (const [label, calculation] of [["campaign", campaignCalculation], ["Journal", journalCalculation]]) {
    if (Number(calculation?.start) !== expected.start || Number(calculation?.totalDeductions ?? calculation?.deductions?.reduce?.((sum, value) => sum + Number(value), 0)) !== expected.deduction || Number(calculation?.result) !== expected.result) {
      errors.push(`${label} Campaign-A calculation must be £1,250 − £1,015 = £235.`);
    }
  }
  const campaignSurface = flattenStrings({ channels: campaign?.channels, visualBrief: campaign?.visualBrief, altText: campaign?.altText }).join(" ");
  for (const token of ["£1,250", "£1,015", "£235"]) if (!campaignSurface.includes(token)) errors.push(`Campaign-A social and creative surfaces must include ${token}.`);
  const journalSurface = flattenStrings(journal?.article).join(" ");
  if (!journalSurface.includes("£1,250 − £1,015 = £235")) errors.push("Campaign-A Journal draft must include the approved formula.");
  return { valid: errors.length === 0, errors };
}

function collectArticleLinks(article) {
  const internal = [];
  const external = [];
  for (const block of article.content || []) {
    for (const segment of block.segments || []) {
      if (!segment.href) continue;
      (segment.href.startsWith("/") || /^https:\/\/(?:www\.)?cleartill\.money\//.test(segment.href) ? internal : external).push({ text: segment.text, href: segment.href });
    }
  }
  return { internal, external };
}

function approvalState(value, { blocked = false } = {}) {
  if (value === true) return "PASS";
  return blocked ? "BLOCKED" : "FAIL";
}

function campaignApproval(campaign, journalDraft) {
  const creativeBlocked = !["ready", "review_ready"].includes(campaign.creative?.status) || !(campaign.creative?.registeredExports || []).length;
  const journalLinkBlocked = Boolean(journalDraft && journalDraft.publication?.exportedToLiveCollection === false);
  return {
    Copy: approvalState(campaign.approvalChecks?.copyApproved),
    Claims: approvalState(campaign.claimsChecked || campaign.approvalChecks?.claimsApproved),
    "Product facts": approvalState(campaign.productFactsChecked || campaign.approvalChecks?.productFactsApproved),
    Links: approvalState(campaign.linksChecked || campaign.approvalChecks?.linksApproved, { blocked: journalLinkBlocked }),
    Visual: approvalState(campaign.visualChecked || campaign.approvalChecks?.visualApproved, { blocked: creativeBlocked }),
    Licence: approvalState(campaign.licenceChecked, { blocked: creativeBlocked }),
    Schedule: approvalState(campaign.scheduleChecked || campaign.approvalChecks?.scheduleApproved),
    "Human approval": approvalState(campaign.approvalChecks?.humanApproved),
  };
}

function journalApproval(draft, generatedHero = null) {
  const checks = draft.approvalChecks || {};
  const visualBlocked = !generatedHero?.localPath && (!generatedHero?.canvaDesignUrl || generatedHero?.exportStatus !== "success");
  return {
    Copy: approvalState(checks.copyApproved),
    Claims: approvalState(checks.claimsChecked),
    "Product facts": approvalState(checks.productFactsChecked),
    Links: approvalState(checks.linksChecked, { blocked: true }),
    Visual: approvalState(checks.visualChecked, { blocked: visualBlocked }),
    Licence: approvalState(checks.licenceChecked, { blocked: visualBlocked }),
    Schedule: approvalState(checks.scheduleChecked),
    "Human approval": approvalState(checks.humanApproved),
  };
}

function buildReviewModel(ids = DEFAULT_IDS, { generatedAt = new Date().toISOString() } = {}) {
  const registry = readJson(REGISTRY_PATH);
  const photoBriefs = readJson(PHOTO_BRIEFS_PATH);
  const photoCandidates = readJson(PHOTO_CANDIDATES_PATH);
  const photoSelections = readJson(PHOTO_SELECTIONS_PATH);
  const infographicManifest = readJson(INFOGRAPHIC_MANIFEST_PATH);
  const assetRegister = readJson(ASSET_REGISTER_PATH);
  const registryValidation = validateTemplateRegistry(registry);
  if (!registryValidation.valid) throw new Error(registryValidation.errors.join(" "));
  const templates = new Map(registry.templates.map((template) => [template.key, template]));
  const drafts = journalDrafts();
  const byContentId = new Map(drafts.map((draft) => [draft.record.contentId, draft]));
  const campaigns = ids.map((id) => {
    const record = getContentById(id);
    if (!record) throw new Error(`Unknown content ID: ${id}.`);
    const validation = validateContentRecord(record);
    if (!validation.valid) throw new Error(`${id}: ${validation.errors.join(" ")}`);
    const journal = byContentId.get(id) || null;
    const templateKeys = registry.campaignMappings[id] || record.creative?.templateKeys || [];
    const mappedTemplates = templateKeys.map((key) => templates.get(key)).filter(Boolean);
    const photoBrief = photoBriefs.campaigns?.[id] || null;
    const photoCandidateSet = photoCandidates.campaigns?.[id] || { status: "not_searched", candidates: [] };
    const photoExpired = Boolean(photoCandidates.expiresAt && Date.parse(photoCandidates.expiresAt) <= Date.parse(generatedAt));
    const campaignInfographics = (infographicManifest.assets || []).filter((asset) => asset.contentId === id);
    const editorialAssets = (assetRegister.assets || []).filter((asset) => asset.contentId === id && asset.type === "ai_generated_editorial");
    const productDemoAssets = (assetRegister.assets || []).filter((asset) => asset.contentId === id && ["product_demo_video", "product_demo_cover"].includes(asset.type));
    const hasCanvaArtifacts = campaignInfographics.length > 0 && campaignInfographics.every((asset) => asset.canvaDesignUrl && asset.exportStatus === "success");
    const canvaComplete = hasCanvaArtifacts && campaignInfographics.every((asset) => asset.status !== "needs_product_recording");
    const hasProductDemo = productDemoAssets.some((asset) => asset.type === "product_demo_video");
    const resolvedCreative = hasProductDemo
      ? record.creative
      : hasCanvaArtifacts ? { status: canvaComplete ? "review_ready" : "creative_blocked", generatedCanvaDesignUrl: campaignInfographics[0].canvaDesignUrl, registeredExports: campaignInfographics.map((asset) => ({ path: asset.pngPath, filename: path.basename(asset.pngPath) })) } : record.creative;
    const blockers = hasProductDemo
      ? [...(record.creative?.blockers || [])]
      : hasCanvaArtifacts
      ? (record.creative?.blockers || []).filter((message) => !/(autofill|connector can copy|connector can|manual canva|manual editing)/i.test(message))
      : [...(record.creative?.blockers || [])];
    if (!hasProductDemo && !resolvedCreative?.generatedCanvaDesignUrl) blockers.push("No generated campaign Canva design link is registered.");
    if (!(resolvedCreative?.registeredExports || []).length) blockers.push("No final creative export is registered.");
    if (journal?.record?.publication?.exportedToLiveCollection === false) blockers.push("The Journal destination remains an unpublished local draft.");
    if (photoBrief?.query && (!photoCandidateSet.candidates?.length || photoExpired)) blockers.push("Optional Pixabay photo candidates are not current; add PIXABAY_API_KEY and refresh the stock-photo search before selecting a background.");
    return {
      record,
      sourcePath: "marketing/calendar/content-calendar.json",
      journal: journal?.record || null,
      templates: mappedTemplates,
      creative: resolvedCreative,
      stockPhoto: { brief: photoBrief, results: photoCandidateSet, selection: photoSelections.selections?.[id] || null, approvalInstruction: photoSelections.approvalInstruction, generatedAt: photoCandidates.generatedAt, expiresAt: photoCandidates.expiresAt, expired: photoExpired, provider: photoCandidates.provider },
      infographics: campaignInfographics,
      editorialAssets,
      productDemoAssets,
      blockers: [...new Set(blockers)],
      approval: campaignApproval({ ...record, creative: resolvedCreative }, journal?.record),
    };
  });
  const articles = drafts.filter((draft) => ids.includes(draft.record.contentId)).map((draft) => {
    const validation = validateJournalDraft(draft.record);
    if (!validation.valid) throw new Error(`${draft.relativePath}: ${validation.errors.join(" ")}`);
    const editorialHero = (assetRegister.assets || []).find((asset) => asset.contentId === draft.record.contentId && asset.type === "ai_generated_editorial" && asset.role === "journal_hero") || null;
    const generatedHero = editorialHero || (infographicManifest.assets || []).find((asset) => asset.contentId === draft.record.contentId && asset.role === "journal_hero") || null;
    return {
      record: draft.record,
      sourcePath: draft.relativePath,
      headings: (draft.record.article.content || []).filter((block) => ["heading", "subheading"].includes(block.type)).map((block) => ({ level: block.type === "heading" ? 2 : 3, text: block.text, id: block.id })),
      links: collectArticleLinks(draft.record.article),
      generatedHero,
      approval: journalApproval(draft.record, generatedHero),
      blockers: [
        ...(draft.record.publication?.exportedToLiveCollection ? [] : ["Article is not exported to the live Journal collection."]),
        ...(draft.record.approvalChecks?.linksChecked ? [] : ["Internal links have not received human link approval."]),
        ...(!generatedHero?.localPath && (!generatedHero?.canvaDesignUrl || generatedHero?.exportStatus !== "success") ? ["No generated hero and registered export are present."] : []),
      ],
    };
  });
  const campaignA = campaigns.find((item) => item.record.id === "ct-w01-a01");
  const campaignAArticle = articles.find((item) => item.record.contentId === "ct-w01-a01");
  if (campaignA && campaignAArticle) {
    const arithmetic = validateCampaignAFigures(campaignA.record, campaignAArticle.record);
    if (!arithmetic.valid) throw new Error(arithmetic.errors.join(" "));
  }
  const items = [...campaigns, ...articles];
  const summary = {
    readyForReview: items.length,
    creativeBlocked: items.filter((item) => Object.values(item.approval).includes("BLOCKED") && item.approval.Visual === "BLOCKED").length,
    linkBlocked: items.filter((item) => item.approval.Links === "BLOCKED").length,
    factBlocked: items.filter((item) => item.approval["Product facts"] !== "PASS").length,
    approved: items.filter((item) => Object.values(item.approval).every((value) => value === "PASS")).length,
    totalOutstandingChecks: items.reduce((sum, item) => sum + Object.values(item.approval).filter((value) => value !== "PASS").length, 0),
  };
  const model = {
    schemaVersion: "marketing-review-v1",
    generatedAt,
    ids,
    sourceFiles: ["marketing/calendar/content-calendar.json", "marketing/creative/canva-template-registry.json", "marketing/creative/infographic-manifest.json", "marketing/creative/stock-photo-briefs.json", "marketing/creative/stock-photo-candidates.json", "marketing/creative/stock-photo-selections.json", "marketing/assets/asset-register.json", ...articles.map((article) => article.sourcePath), "app/blog/[slug]/page.jsx", "app/globals.css"],
    liveJournalSource: path.relative(path.resolve(MARKETING_ROOT, ".."), LIVE_JOURNAL_PATH),
    registry,
    campaigns,
    articles,
    summary,
  };
  model.modelDigest = crypto.createHash("sha256").update(JSON.stringify(model)).digest("hex");
  return model;
}

function stateBadge(state) { return `<span class="state state-${state.toLowerCase()}">${state}</span>`; }
function renderApprovalRows(items) {
  const columns = ["Copy", "Claims", "Product facts", "Links", "Visual", "Licence", "Schedule", "Human approval"];
  return `<div class="table-wrap"><table class="approval-table"><thead><tr><th>Item</th>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${items.map((item) => `<tr><th>${escapeHtml(item.name)}</th>${columns.map((column) => `<td>${stateBadge(item.approval[column])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function renderSegments(segments = [], text = "") {
  if (!segments.length) return escapeHtml(text);
  return segments.map((segment) => {
    let result = escapeHtml(segment.text);
    if (segment.strong) result = `<strong>${result}</strong>`;
    return segment.href ? link(segment.href, segment.text).replace(escapeHtml(segment.text), result) : result;
  }).join("");
}
function renderArticleBlock(block, faqs) {
  if (block.type === "heading") return `<h2 id="${escapeHtml(block.id)}">${escapeHtml(block.text)}</h2>`;
  if (block.type === "subheading") return `<h3 id="${escapeHtml(block.id)}">${escapeHtml(block.text)}</h3>`;
  if (block.type === "quote") return `<blockquote>${escapeHtml(block.text)}</blockquote>`;
  if (block.type === "list") return `<ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  if (block.type === "ordered-list") return `<ol>${block.items.map((item) => `<li>${renderSegments(item)}</li>`).join("")}</ol>`;
  if (block.type === "formula") return `<aside class="article-formula"><span>${escapeHtml(block.label)}</span><strong>=</strong><b>${escapeHtml(block.formula)}</b></aside>`;
  if (block.type === "result") return `<p class="article-result">${renderSegments(block.segments)}</p>`;
  if (block.type === "table") return `<div class="article-table-wrap"><table><caption>${escapeHtml(block.caption)}</caption><thead><tr>${block.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${block.rows.map((row, index) => `<tr class="${index === block.totalRow ? "is-total" : ""}">${row.map((cell, cellIndex) => `<${cellIndex === 0 ? "th" : "td"}>${escapeHtml(cell)}</${cellIndex === 0 ? "th" : "td"}>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  if (block.type === "faqs") return `<div class="article-faqs">${faqs.map((faq) => `<section><h3>${escapeHtml(faq.question)}</h3><p>${escapeHtml(faq.answer)}</p></section>`).join("")}</div>`;
  if (block.type === "callout") return `<aside class="article-callout"><strong>${escapeHtml(block.title)}</strong><p>${escapeHtml(block.text)}</p></aside>`;
  return `<p>${renderSegments(block.segments, block.text)}</p>`;
}
function renderArticle(articleItem, { compact = false } = {}) {
  const draft = articleItem.record;
  const article = draft.article;
  const heroPath = articleItem.generatedHero?.localPath || articleItem.generatedHero?.pngPath;
  const heroImage = heroPath ? `<img class="article-hero-image" src="../../${escapeHtml(heroPath.replace(/^marketing\//, ""))}" alt="${escapeHtml(articleItem.generatedHero?.altText || article.title)}">` : "";
  return `<article class="article-preview ${compact ? "mobile-preview" : "desktop-preview"}">
    <header class="article-hero"><p class="eyebrow">${escapeHtml(article.category)}</p><h1>${escapeHtml(article.title)}</h1><p class="article-description">${escapeHtml(article.description)}</p><div class="article-meta"><span>By ClearTill</span><span>·</span><span>${draft.publication?.exportedToLiveCollection ? "PUBLISHED" : "DRAFT — NOT PUBLISHED"}</span><span>·</span><span>${article.readingMinutes} min read</span></div></header>
    ${heroImage}
    <div class="article-layout"><aside class="article-summary"><span>In one sentence</span><p>${escapeHtml(article.takeaway)}</p></aside><div class="article-content">${article.content.map((block) => renderArticleBlock(block, article.faqs || [])).join("")}<aside class="article-disclaimer"><strong>Good to know</strong><p>${escapeHtml(article.disclaimer || "This guide is general information, not personalised financial advice. ClearTill outputs are estimates based on the figures entered by the user.")}</p></aside></div></div>
  </article>`;
}

function renderArticleReview(articleItem) {
  const draft = articleItem.record;
  const article = draft.article;
  return `<section class="review-section article-review" id="article-${escapeHtml(article.slug)}">
    <header class="section-head"><div><p class="eyebrow">Journal review</p><h2>${escapeHtml(article.title)}</h2></div>${stateBadge(Object.values(articleItem.approval).every((value) => value === "PASS") ? "PASS" : "BLOCKED")}</header>
    <dl class="facts"><div><dt>Slug</dt><dd>${escapeHtml(article.slug)}</dd></div><div><dt>Meta title</dt><dd>${escapeHtml(article.seoTitle)}</dd></div><div><dt>Meta description</dt><dd>${escapeHtml(article.description)}</dd></div><div><dt>Category</dt><dd>${escapeHtml(article.category)}</dd></div><div><dt>Estimated reading time</dt><dd>${article.readingMinutes} minutes</dd></div><div><dt>Publication state</dt><dd>${draft.publication?.exportedToLiveCollection ? `PUBLISHED · ${escapeHtml(draft.publication.publishedAt)}` : "DRAFT — NOT PUBLISHED"}</dd></div><div><dt>CTA</dt><dd>${link(draft.campaign.productUrl)}</dd></div><div><dt>Source</dt><dd><code>${escapeHtml(articleItem.sourcePath)}</code></dd></div></dl>
    <h3>Approval</h3>${renderApprovalRows([{ name: article.title, approval: articleItem.approval }])}
    <h3>Headings hierarchy</h3><ol class="heading-list">${articleItem.headings.map((heading) => `<li class="level-${heading.level}">H${heading.level}: ${escapeHtml(heading.text)}</li>`).join("")}</ol>
    <h3>Internal links</h3><ul>${articleItem.links.internal.map((item) => `<li>${link(item.href, item.text)} <code>${escapeHtml(item.href)}</code></li>`).join("") || "<li>None</li>"}</ul>
    <h3>External references</h3><ul>${articleItem.links.external.map((item) => `<li>${link(item.href, item.text)} <code>${escapeHtml(item.href)}</code></li>`).join("") || "<li>None required in this draft.</li>"}</ul>
    <h3>Product and claims qualifications</h3><ul><li>Outputs are estimates based on the figures entered.</li><li>ClearTill is not financial advice or a guarantee.</li><li>No bank login or Open Banking connection is required.</li></ul>
    <h3>Unresolved blockers</h3><ul class="blockers">${articleItem.blockers.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    <div class="preview-grid"><div><h3>Desktop article preview</h3>${renderArticle(articleItem)}</div><div><h3>Narrow mobile article preview</h3><div class="mobile-frame">${renderArticle(articleItem, { compact: true })}</div></div></div>
  </section>`;
}

function renderStockPhotoReview(campaignItem) {
  const photo = campaignItem.stockPhoto;
  const campaign = campaignItem.record;
  const candidates = photo?.results?.candidates || [];
  const selection = photo?.selection;
  const status = photo?.brief?.query ? (photo.expired ? "expired — refresh required" : photo.results.status) : "not required";
  const approvalStyles = `<style>.approval-instruction{margin:18px 0;padding:18px;border:2px solid var(--accent);border-radius:12px;background:var(--soft)}.approval-instruction code{display:block;padding:12px;border-radius:8px;background:#fff;font-weight:800}.photo-card{position:relative}.photo-card.is-recommended{grid-column:span 2;border:3px solid var(--accent);box-shadow:0 12px 30px rgba(15,118,110,.16)}.recommendation-badge{display:block;padding:9px 13px;background:var(--accent);color:#fff;font-size:.75rem;font-weight:900;letter-spacing:.05em;text-transform:uppercase}.selection-details{margin:12px;border-top:1px solid var(--line)}@media(max-width:850px){.photo-card.is-recommended{grid-column:span 1}}</style>`;
  const cards = candidates.map((candidate) => {
    const recommended = selection?.providerAssetId === candidate.providerAssetId;
    return `<article class="photo-card ${recommended ? "is-recommended" : ""}">
    ${recommended ? '<span class="recommendation-badge">Recommended for approval</span>' : ""}
    <img src="${escapeHtml(safeHref(candidate.previewUrl))}" alt="Pixabay candidate for ${escapeHtml(campaign.id)}; ${escapeHtml((candidate.tags || []).join(", "))}">
    <p><strong>${escapeHtml(candidate.creator)}</strong> · ${escapeHtml(candidate.width)} × ${escapeHtml(candidate.height)}</p>
    <p>${link(candidate.sourceUrl, "View source and full context")} · ${link(candidate.creatorProfileUrl, "Contributor")}</p>
    <p><strong>${escapeHtml(candidate.selectionStatus)}</strong>${candidate.automatedRiskFlags?.length ? ` · ${escapeHtml(candidate.automatedRiskFlags.join("; "))}` : " · No tag-based risk detected; visual inspection is still required."}</p>
    <p>${escapeHtml(candidate.licence)} · Licence, releases, trademarks and sensitive context remain unapproved.</p>
    ${recommended ? `<div class="selection-details"><p><strong>Placement:</strong> ${escapeHtml(selection.placement)}</p><p><strong>Why this fits:</strong> ${escapeHtml(selection.rationale)}</p><p><strong>Proposed alt text:</strong> ${escapeHtml(selection.altText)}</p><p><strong>Caption:</strong> ${escapeHtml(selection.caption)}</p><p><strong>Credit:</strong> ${escapeHtml(selection.credit)}</p></div>` : ""}
    <code>Pixabay ID ${escapeHtml(candidate.providerAssetId)}</code>
  </article>`;
  }).join("");
  return `${approvalStyles}<div class="stock-review"><h3>Optional stock-photo review</h3>
    <p><strong>Image source:</strong> ${link("https://pixabay.com/", "Images and videos via Pixabay")}</p>
    <p><strong>Status:</strong> ${escapeHtml(status)}</p>
    ${selection ? `<div class="approval-instruction"><strong>Your approval action</strong><p>Review the highlighted photograph, its placement, caption and alt text. If both recommended photographs are acceptable, reply:</p><code>${escapeHtml(photo.approvalInstruction)}</code><p>No Pixabay photograph will be downloaded, added to an article or deployed until that approval is received.</p></div>` : ""}
    <p><strong>Role:</strong> ${escapeHtml(photo?.brief?.role || "No stock-photo role configured.")}</p>
    ${photo?.brief?.query ? `<p><strong>Pixabay query:</strong> <code>${escapeHtml(photo.brief.query)}</code></p>` : ""}
    <p><strong>Composition:</strong> ${escapeHtml(photo?.brief?.composition || "Not applicable.")}</p>
    <p><strong>Avoid:</strong> ${escapeHtml((photo?.brief?.avoid || []).join("; "))}</p>
    ${cards ? `<div class="photo-grid">${cards}</div>` : photo?.brief?.query ? `<div class="blocked-panel"><p>No stock-photo candidates are stored. Set the server-only <code>PIXABAY_API_KEY</code>, then run <code>npm run content:photos -- --ids=${escapeHtml(campaign.id)}</code>.</p></div>` : ""}
    <p class="stock-rule">Candidate URLs are temporary review references. An approved image must be downloaded into ClearTill-controlled storage and entered in the asset register before Canva or Buffer use.</p>
  </div>`;
}

function renderInfographicReview(campaignItem) {
  const assets = campaignItem.infographics || [];
  return `<div class="stock-review"><h3>Generated supporting infographics</h3><div class="photo-grid">${assets.map((asset) => {
    const localHref = `../../${escapeHtml(asset.pngPath.replace(/^marketing\//, ""))}`;
    return `<article class="photo-card"><img src="${localHref}" alt="${escapeHtml(asset.altText)}"><p><strong>${escapeHtml(asset.key)}</strong> · ${asset.width} × ${asset.height}</p><p>Status: ${escapeHtml(asset.status)}</p><p>${asset.canvaDesignUrl ? link(asset.canvaDesignUrl, "Open Canva design") : "Canva design pending upload"}</p><code>${escapeHtml(asset.pngPath)}</code></article>`;
  }).join("")}</div></div>`;
}

function renderEditorialReview(campaignItem) {
  const assets = campaignItem.editorialAssets || [];
  if (!assets.length) return "";
  return `<div class="editorial-review"><div class="editorial-intro"><p class="eyebrow">Recommended creative direction</p><h3>Professional editorial v02</h3><p>AI-generated editorial photography with verified ClearTill copy and the real logo applied separately. These remain drafts pending human visual and likeness review.</p></div><div class="editorial-grid">${assets.map((asset) => {
    const localHref = `../../${escapeHtml(asset.localPath.replace(/^marketing\//, ""))}`;
    return `<article class="editorial-card"><img src="${localHref}" alt="${escapeHtml(asset.altText)}"><p><strong>${escapeHtml(asset.role.replaceAll("_", " "))}</strong></p><code>${escapeHtml(asset.localPath)}</code></article>`;
  }).join("")}</div></div>`;
}

function renderProductDemoReview(campaignItem) {
  const assets = campaignItem.productDemoAssets || [];
  if (!assets.length) return "";
  const cover = assets.find((asset) => asset.type === "product_demo_cover");
  const allVideos = assets.filter((asset) => asset.type === "product_demo_video");
  const highestVersion = Math.max(...allVideos.map((asset) => Number((asset.assetId || "").match(/-v(\d+)$/)?.[1] || 0)));
  const currentVideos = allVideos.filter((asset) => Number((asset.assetId || "").match(/-v(\d+)$/)?.[1] || 0) === highestVersion);
  const videos = currentVideos.length ? currentVideos : allVideos;
  const coverHref = cover ? `../../${escapeHtml(cover.localPath.replace(/^marketing\//, ""))}` : "";
  return `<div class="product-demo-review"><div class="editorial-intro"><p class="eyebrow">Primary campaign creative</p><h3>Real ClearTill product demonstration</h3><p>The recording uses confirmed fictional test data. The current videos include a complete branded first frame, timed hook, original ClearTill soundtrack, animated callouts, an estimate disclosure and a CTA outro; the figures have been arithmetically validated. Human visual, audio and claims approval are still required.</p></div><div class="product-demo-grid">${videos.map((asset) => {
    const localHref = `../../${escapeHtml(asset.localPath.replace(/^marketing\//, ""))}`;
    const poster = asset.role === "instagram_reel" && coverHref ? ` poster="${coverHref}"` : "";
    return `<article class="product-video-card"><video controls playsinline preload="metadata"${poster}><source src="${localHref}" type="video/mp4">Your browser cannot preview this MP4.</video><p><strong>${escapeHtml(asset.role.replaceAll("_", " "))}</strong> · ${asset.width} × ${asset.height} · ${escapeHtml(asset.durationSeconds)} seconds · ${asset.audioPresent ? "original soundtrack" : "no audio"}</p><code>${escapeHtml(asset.localPath)}</code></article>`;
  }).join("")}${cover ? `<article class="product-video-card cover-card"><img src="${coverHref}" alt="${escapeHtml(cover.altText || "ClearTill product demonstration reel cover")}"><p><strong>Instagram reel cover</strong> · ${cover.width} × ${cover.height}</p><code>${escapeHtml(cover.localPath)}</code></article>` : ""}</div></div>`;
}

function renderCampaign(campaignItem) {
  const campaign = campaignItem.record;
  const creative = campaignItem.creative || campaign.creative;
  return `<section class="review-section campaign-review" id="campaign-${escapeHtml(campaign.id)}">
    <header class="section-head"><div><p class="eyebrow">Campaign ${escapeHtml(campaign.id)}</p><h2>${escapeHtml(campaign.title)}</h2></div>${stateBadge(campaignItem.approval.Visual === "BLOCKED" ? "BLOCKED" : "FAIL")}</header>
    <dl class="facts"><div><dt>Status</dt><dd>${escapeHtml(campaign.status)}</dd></div><div><dt>Headline</dt><dd>${escapeHtml(campaign.headline)}</dd></div><div><dt>Hypothesis</dt><dd>${escapeHtml(campaign.hypothesis)}</dd></div><div><dt>Target audience</dt><dd>${escapeHtml(campaign.targetAudience)}</dd></div><div><dt>Publication</dt><dd>${escapeHtml(campaign.date)} · ${escapeHtml(campaign.timezone || "Europe/London")}</dd></div><div><dt>Primary success metric</dt><dd>${escapeHtml(campaign.primaryMeasurementGoal)}</dd></div><div><dt>Kill criteria</dt><dd>${escapeHtml(campaign.killCriteria)}</dd></div><div><dt>Destination</dt><dd>${link(campaign.channels.linkedin.url, campaign.landingPath)}</dd></div><div><dt>CTA</dt><dd>${escapeHtml(campaign.CTA)}</dd></div><div><dt>Source</dt><dd><code>${escapeHtml(campaignItem.sourcePath)}</code></dd></div></dl>
    <h3>Approval</h3>${renderApprovalRows([{ name: campaign.id, approval: campaignItem.approval }])}
    <h3>Tracked URLs</h3><ul class="tracked-urls">${Object.entries(campaign.channels).map(([channel, value]) => `<li><strong>${escapeHtml(channel)}</strong>${link(value.url)}<code>${escapeHtml(value.url)}</code></li>`).join("")}</ul>
    <h3>Channel copy</h3><div class="channel-tabs">${Object.entries(campaign.channels).map(([channel, value]) => `<section><div class="copy-head"><div><h4>${escapeHtml(channel)}</h4><small>Recommended: ${escapeHtml(value.recommendedPublishAt || campaign.date)} · Europe/London</small></div><button type="button" data-copy-target="copy-${campaign.id}-${channel}">Copy text</button></div><pre id="copy-${campaign.id}-${channel}">${escapeHtml(value.text)}</pre></section>`).join("")}</div>
    <h3>Creative direction</h3><div class="creative-grid"><div><h4>Visual brief</h4><p>${escapeHtml(campaign.visualBrief)}</p><h4>Alt text</h4><p>${escapeHtml(campaign.altText)}</p><h4>Expected filenames</h4><ul>${Object.entries(campaign.expectedCanvaExports || {}).map(([channel, filename]) => `<li><strong>${escapeHtml(channel)}:</strong> <code>${escapeHtml(filename)}</code></li>`).join("")}</ul></div><div><h4>Canonical Canva sources</h4><p>${link(campaignItem.templates[0]?.canvaFolderUrl, "Open canonical brand-template folder")}</p>${campaignItem.templates.map((template) => `<article class="template-card"><strong>${escapeHtml(template.name)}</strong><p>Mode: <code>${escapeHtml(template.automationMode)}</code></p><p>Native ID: <code>${escapeHtml(template.canvaDesignId || "not discovered")}</code></p><p>BTM ID: <code>${escapeHtml(template.canvaBrandTemplateId || "none")}</code></p><p>${link(template.canvaDesignUrl, "Open Canva source")}</p><ul>${template.manualChangesRequired.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ul></article>`).join("")}<p><strong>Generated campaign design:</strong> ${link(creative?.generatedCanvaDesignUrl, "Not registered")}</p><p><strong>Registered exports:</strong> ${(creative?.registeredExports || []).map((asset) => link(asset.url || asset.path, asset.filename || asset.path)).join(", ") || "None"}</p></div></div>
    ${renderEditorialReview(campaignItem)}
    ${renderProductDemoReview(campaignItem)}
    <details class="legacy-creative"><summary>Show supporting v01 infographics</summary>${renderInfographicReview(campaignItem)}</details>
    ${renderStockPhotoReview(campaignItem)}
    <div class="blocked-panel"><h3>Creative blocked</h3><ul>${campaignItem.blockers.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
    ${campaignItem.journal ? `<p class="journal-destination"><strong>Journal destination:</strong> ${escapeHtml(campaignItem.journal.article.title)} — DRAFT, NOT PUBLISHED.</p>` : `<p class="journal-destination"><strong>Product destination:</strong> ${link(campaign.channels.linkedin.url, "/start")}. No Journal article is required.</p>`}
  </section>`;
}

function styles() {
  return `:root{--bg:#f7f4ed;--panel:#fffdf8;--ink:#1f2522;--muted:#59625d;--line:#d9d4ca;--accent:#0f766e;--accent-dark:#114f49;--soft:#e8f3ef}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55}.draft-banner{position:sticky;top:0;z-index:20;padding:12px 20px;background:#8b2e22;color:#fff;text-align:center;font-weight:900;letter-spacing:.09em}.shell{width:min(1200px,100%);margin:auto;padding:34px 28px 90px}.review-hero{padding:55px;border:1px solid #bad8cd;border-radius:24px;background:linear-gradient(135deg,#dcefe7,#fffdf8)}h1,h2{font-family:Georgia,"Times New Roman",serif;font-weight:500;letter-spacing:-.035em}h1{max-width:850px;margin:0;font-size:clamp(2.8rem,7vw,6rem);line-height:.92}.review-hero>p{max-width:760px;color:var(--muted)}.eyebrow{margin:0 0 10px;color:var(--accent-dark);font-size:.74rem;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.summary-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:28px 0}.summary-grid div{padding:18px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}.summary-grid strong{display:block;font-size:1.8rem}.contents{margin:28px 0;padding:24px;border:1px solid var(--line);border-radius:16px;background:var(--panel)}.contents ol{columns:2}.contents a{color:var(--accent-dark)}.review-section{margin-top:34px;padding:38px;border:1px solid var(--line);border-radius:20px;background:var(--panel);box-shadow:0 12px 32px rgba(31,37,34,.05)}.section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.section-head h2{margin:0;font-size:clamp(2rem,4vw,3.5rem);line-height:1}.state{display:inline-flex;padding:5px 9px;border-radius:999px;font-size:.68rem;font-weight:900;letter-spacing:.06em}.state-pass{background:#d8efe4;color:#17583f}.state-fail{background:#f7e0dc;color:#842d22}.state-blocked{background:#f4e6bd;color:#6f4d08}.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin:28px 0;background:var(--line);border:1px solid var(--line);border-radius:12px;overflow:hidden}.facts div{padding:14px 16px;background:var(--panel)}dt{color:var(--muted);font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em}dd{margin:5px 0 0}.table-wrap{overflow-x:auto}.approval-table{width:100%;border-collapse:collapse;font-size:.8rem}.approval-table th,.approval-table td{padding:10px;border:1px solid var(--line);text-align:center}.approval-table th:first-child{text-align:left}.tracked-urls{display:grid;gap:12px;padding:0;list-style:none}.tracked-urls li{padding:14px;border:1px solid var(--line);border-radius:10px}.tracked-urls strong{display:block;text-transform:capitalize}.tracked-urls a{overflow-wrap:anywhere}.tracked-urls code{display:block;margin-top:7px;color:var(--muted);font-size:.72rem;overflow-wrap:anywhere}.channel-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.channel-tabs section{border:1px solid var(--line);border-radius:12px;overflow:hidden}.copy-head{display:flex;align-items:center;justify-content:space-between;padding:10px 13px;background:var(--soft)}.copy-head h4{margin:0;text-transform:capitalize}.copy-head button{border:1px solid var(--accent-dark);border-radius:7px;background:transparent;color:var(--accent-dark);padding:6px 8px;font-weight:750}.channel-tabs pre{margin:0;padding:16px;white-space:pre-wrap;font:inherit;font-size:.88rem}.creative-grid,.preview-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.template-card{margin-bottom:10px;padding:14px;border:1px solid var(--line);border-radius:10px}.template-card p{margin:5px 0}.blocked-panel{margin-top:24px;padding:20px;border:1px solid #d8b663;border-radius:12px;background:#fff5d8}.blocked-panel h3{margin-top:0}.journal-destination{padding:15px;border-left:3px solid var(--accent);background:var(--soft)}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.article-preview{margin-top:16px;padding:30px;border:1px solid var(--line);border-radius:16px;background:var(--bg)}.article-hero{max-width:760px;margin:25px auto 45px;text-align:center}.article-hero h1{font-size:clamp(2.7rem,6vw,5rem)}.article-description{color:var(--muted)}.article-meta{display:flex;justify-content:center;gap:7px;flex-wrap:wrap;color:var(--muted);font-size:.78rem}.article-layout{display:grid;grid-template-columns:200px minmax(0,620px);gap:42px;justify-content:center;border-top:1px solid var(--line);padding-top:35px}.article-summary{padding:18px;border-left:3px solid var(--accent);background:var(--soft)}.article-summary span{font-size:.7rem;font-weight:850;text-transform:uppercase}.article-content{font-family:Georgia,"Times New Roman",serif;font-size:1.08rem;line-height:1.8}.article-content h2,.article-content h3{font-family:ui-sans-serif,system-ui,sans-serif}.article-content h2{margin:48px 0 16px;font-size:2rem}.article-content h3{margin:34px 0 12px}.article-content a{color:var(--accent-dark);font-weight:700}.article-content blockquote{padding-left:22px;border-left:3px solid #77ad9b;color:#31564c;font-style:italic}.article-formula,.article-callout{break-inside:avoid;margin:28px 0;padding:22px;border:1px solid #bed8cf;border-radius:13px;background:#e3f0eb}.article-formula{display:grid;grid-template-columns:1fr auto 1fr;gap:14px;align-items:center;font-family:ui-sans-serif,system-ui,sans-serif}.article-result{break-inside:avoid;padding:18px;border-left:4px solid var(--accent);background:#f1ece2}.article-table-wrap{break-inside:avoid;overflow-x:auto;margin:25px 0;border:1px solid var(--line);border-radius:11px}.article-table-wrap table{width:100%;border-collapse:collapse;font-family:ui-sans-serif,system-ui,sans-serif;font-size:.88rem}.article-table-wrap caption{text-align:left;padding:10px;font-weight:800}.article-table-wrap th,.article-table-wrap td{padding:10px;border-bottom:1px solid var(--line);text-align:left}.article-table-wrap td:last-child{text-align:right}.article-table-wrap .is-total{background:#f1ece2;font-weight:850}.article-faqs section{break-inside:avoid;margin:8px 0;padding:16px;border:1px solid var(--line);border-radius:10px}.article-faqs h3{margin:0}.article-faqs p{margin:7px 0 0}.article-disclaimer{margin-top:45px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted)}.mobile-frame{width:390px;max-width:100%;margin:auto;border:8px solid #1f2522;border-radius:24px;overflow:hidden}.mobile-frame .article-preview{margin:0;padding:16px;border:0;border-radius:0}.mobile-frame .article-hero h1{font-size:2.35rem}.mobile-frame .article-layout{grid-template-columns:1fr;gap:18px}.mobile-frame .article-content{font-size:.96rem}.mobile-frame .article-formula{grid-template-columns:1fr}.heading-list .level-3{margin-left:28px}.blockers{color:#6f4d08}.missing{color:#8b2e22;font-weight:700}@page{size:A4;margin:14mm 12mm 18mm}@media(max-width:850px){.summary-grid{grid-template-columns:repeat(2,1fr)}.facts,.channel-tabs,.creative-grid,.preview-grid{grid-template-columns:1fr}.contents ol{columns:1}.article-layout{grid-template-columns:1fr}.review-section{padding:24px}}@media print{body{background:#fff}.draft-banner{position:static}.shell{width:auto;padding:0}.review-hero,.review-section{box-shadow:none;break-before:page}.review-hero{break-before:auto}.copy-head button{display:none}.contents{break-after:page}.channel-tabs{grid-template-columns:1fr}.preview-grid{grid-template-columns:1fr}.mobile-frame{break-before:page}a{color:inherit;text-decoration:underline}.state{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
}

function documentShell({ title, model, body }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="robots" content="noindex,nofollow"><style>${styles()}.stock-review{margin-top:28px;padding-top:22px;border-top:1px solid var(--line)}.photo-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.photo-card{overflow:hidden;border:1px solid var(--line);border-radius:12px;background:var(--panel)}.photo-card img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;background:#ece8df}.photo-card p,.photo-card code{display:block;margin:10px 13px}.stock-rule{color:var(--muted);font-size:.84rem}.editorial-review,.product-demo-review{margin:34px -14px 0;padding:28px 14px;border-top:4px solid var(--accent);background:#f0f8f4}.editorial-intro{max-width:760px}.editorial-intro h3{margin:.2rem 0;font-size:1.8rem}.editorial-grid,.product-demo-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:22px}.editorial-card,.product-video-card{overflow:hidden;border:1px solid #b9d7cc;border-radius:16px;background:#fff;box-shadow:0 12px 28px rgba(20,60,58,.1)}.editorial-card img,.product-video-card video,.product-video-card img{display:block;width:100%;height:auto;background:#111}.product-video-card p,.product-video-card code,.editorial-card p,.editorial-card code{display:block;margin:12px 16px}.product-video-card video{max-height:680px}.cover-card img{max-height:680px;object-fit:contain}.legacy-creative{margin-top:24px}.legacy-creative summary{cursor:pointer;color:var(--accent-dark);font-weight:800}.article-hero-image{display:block;width:min(100%,900px);height:auto;margin:0 auto 42px;border-radius:18px;box-shadow:0 14px 34px rgba(20,60,58,.12)}@media(max-width:850px){.photo-grid,.editorial-grid,.product-demo-grid{grid-template-columns:1fr}}</style></head><body><div class="draft-banner">DRAFT — NOT PUBLISHED · NO LIVE PUBLICATION CONTROLS</div><main class="shell">${body}<footer><p>Generated ${escapeHtml(model.generatedAt)} · Source model ${escapeHtml(model.modelDigest)}</p><p>Source files: ${model.sourceFiles.map((file) => `<code>${escapeHtml(file)}</code>`).join(" · ")}</p></footer></main><script>document.addEventListener('click',function(event){const button=event.target.closest('[data-copy-target]');if(!button||!navigator.clipboard)return;const target=document.getElementById(button.dataset.copyTarget);if(target)navigator.clipboard.writeText(target.innerText).then(function(){button.textContent='Copied';});});</script></body></html>`;
}

function renderReviewHtml(model) {
  const approvalItems = [
    ...model.campaigns.map((item) => ({ name: item.record.id, approval: item.approval })),
    ...model.articles.map((item) => ({ name: item.record.article.slug, approval: item.approval })),
  ];
  const body = `<header class="review-hero"><p class="eyebrow">ClearTill human review pack</p><h1>First three campaigns and Journal drafts</h1><p>Local review document generated from the structured campaign and Journal JSON records. Nothing in this pack is published or scheduled.</p><p><strong>Generated:</strong> ${escapeHtml(model.generatedAt)}</p></header>
    <section class="summary-grid"><div><span>Ready for review</span><strong>${model.summary.readyForReview}</strong></div><div><span>Creative blocked</span><strong>${model.summary.creativeBlocked}</strong></div><div><span>Link blocked</span><strong>${model.summary.linkBlocked}</strong></div><div><span>Fact blocked</span><strong>${model.summary.factBlocked}</strong></div><div><span>Approved</span><strong>${model.summary.approved}</strong></div><div><span>Outstanding checks</span><strong>${model.summary.totalOutstandingChecks}</strong></div></section>
    <nav class="contents" aria-label="Review contents"><h2>Contents</h2><ol>${model.campaigns.map((item) => `<li><a href="#campaign-${escapeHtml(item.record.id)}">${escapeHtml(item.record.id)} — ${escapeHtml(item.record.title)}</a></li>`).join("")}${model.articles.map((item) => `<li><a href="#article-${escapeHtml(item.record.article.slug)}">Journal — ${escapeHtml(item.record.article.title)}</a></li>`).join("")}</ol></nav>
    <section class="review-section"><h2>Approval summary</h2>${renderApprovalRows(approvalItems)}</section>
    ${model.campaigns.map(renderCampaign).join("")}${model.articles.map(renderArticleReview).join("")}`;
  const html = documentShell({ title: "ClearTill first three campaigns review", model, body });
  assertNoSecrets(html);
  return html;
}

function renderArticleReviewHtml(model, articleItem) {
  const body = `<header class="review-hero"><p class="eyebrow">ClearTill Journal human review</p><h1>${escapeHtml(articleItem.record.article.title)}</h1><p>Standalone local article review generated from the same model used by the campaign review pack.</p><p><strong>Generated:</strong> ${escapeHtml(model.generatedAt)}</p></header>${renderArticleReview(articleItem)}`;
  const html = documentShell({ title: `${articleItem.record.article.title} — draft review`, model, body });
  assertNoSecrets(html);
  return html;
}

function assertNoSecrets(html) {
  for (const pattern of SECRET_PATTERNS) if (pattern.test(html)) throw new Error(`Review output contains a prohibited secret pattern: ${pattern}.`);
  return true;
}

async function writePdfFromHtml(htmlPath, pdfPath, { launch = (options) => chromium.launch(options) } = {}) {
  const browser = await launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).toString(), { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: '<div style="width:100%;font-size:8px;color:#59625d;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span> · DRAFT — NOT PUBLISHED</div>',
      margin: { top: "12mm", right: "12mm", bottom: "18mm", left: "12mm" },
    });
  } finally { await browser.close(); }
  return pdfPath;
}

async function generateReviewArtifacts({ ids = DEFAULT_IDS, format = "both", outputDirectory = REVIEW_ROOT, generatedAt } = {}) {
  if (!ids.length) throw new Error("At least one content ID is required.");
  const model = buildReviewModel(ids, { generatedAt });
  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputs = { html: [], pdf: [], modelDigest: model.modelDigest };
  const pages = [
    { basename: "first-three-campaigns-review", html: renderReviewHtml(model) },
    ...model.articles.map((article) => ({ basename: article.record.article.slug, html: renderArticleReviewHtml(model, article) })),
  ];
  for (const item of pages) {
    const htmlPath = path.join(outputDirectory, `${item.basename}.html`);
    fs.writeFileSync(htmlPath, item.html);
    outputs.html.push(htmlPath);
    if (format === "pdf" || format === "both") {
      const pdfPath = path.join(outputDirectory, `${item.basename}.pdf`);
      await writePdfFromHtml(htmlPath, pdfPath);
      outputs.pdf.push(pdfPath);
    }
  }
  return outputs;
}

module.exports = {
  DEFAULT_IDS,
  REGISTRY_PATH,
  REVIEW_ROOT,
  assertNoSecrets,
  buildReviewModel,
  generateReviewArtifacts,
  renderArticleBlock,
  renderArticleReviewHtml,
  renderReviewHtml,
  validateCampaignAFigures,
  validateTemplateRegistry,
  writePdfFromHtml,
};
