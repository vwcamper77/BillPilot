"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildCampaignUrl } = require("./utm");
const { validateJournalDraft } = require("./JournalDraftAdapter");

const REPO_ROOT = path.resolve(__dirname, "../..");
const MARKETING_ROOT = path.join(REPO_ROOT, "marketing");
const SUPPORTED_CHANNELS = new Set(["linkedin", "facebook", "instagram"]);
const REQUIRED_FIELDS = ["id", "date", "experimentId", "hypothesis", "targetAudience", "contentPillar", "messageVariant", "format", "sourceOrRationale", "CTA", "landingPath", "utm", "channels", "visualBrief", "altText", "status", "claimsChecked", "productFactsChecked", "results", "decision"];
const VALID_STATUSES = new Set(["draft", "in_review", "approved", "rejected"]);

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function calendarPath() { return path.join(MARKETING_ROOT, "calendar/content-calendar.json"); }
function loadCalendar() { return readJson(calendarPath()); }
function listContent() { return loadCalendar().posts; }
function getContentById(id) { return listContent().find((post) => post.id === id) || null; }

function flattenStrings(value, result = []) {
  if (typeof value === "string") result.push(value);
  else if (Array.isArray(value)) value.forEach((item) => flattenStrings(item, result));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => flattenStrings(item, result));
  return result;
}

function loadClaimsPolicy() { return readJson(path.join(MARKETING_ROOT, "brand/claims-policy.json")); }

function validateContentRecord(record, { claimsPolicy = loadClaimsPolicy() } = {}) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) return { valid: false, errors: ["Content record must be an object."] };
  for (const field of REQUIRED_FIELDS) {
    if (record[field] == null || record[field] === "" || (typeof record[field] === "object" && !Array.isArray(record[field]) && Object.keys(record[field]).length === 0)) errors.push(`Missing required field: ${field}.`);
  }
  if (record.sourceOrRationale && String(record.sourceOrRationale).trim().length < 20) errors.push("sourceOrRationale must identify meaningful evidence or reasoning.");
  if (!VALID_STATUSES.has(record.status)) errors.push(`Unsupported approval status: ${record.status || "missing"}.`);
  const channels = record.channels && typeof record.channels === "object" ? Object.keys(record.channels) : [];
  for (const channel of channels) if (!SUPPORTED_CHANNELS.has(channel)) errors.push(`Unsupported channel: ${channel}.`);
  for (const channel of SUPPORTED_CHANNELS) {
    if (!record.channels?.[channel]?.text?.trim()) errors.push(`Missing ${channel} version.`);
  }
  if (record.illustrativeExample === true) {
    for (const channel of channels) {
      if (!/illustrative/i.test(record.channels[channel]?.text || "")) errors.push(`${channel} must label its example as illustrative.`);
    }
  }
  try {
    buildCampaignUrl({ landingPath: record.landingPath, utm: record.utm });
    for (const channel of SUPPORTED_CHANNELS) {
      if (record.channels?.[channel]?.url) {
        const expected = buildCampaignUrl({ landingPath: record.landingPath, utm: record.utm, channel });
        if (record.channels[channel].url !== expected) errors.push(`${channel} campaign URL does not match the canonical UTM URL.`);
      }
    }
  } catch (error) { errors.push(error.message); }
  for (const calculation of record.illustrativeCalculations || []) {
    const start = Number(calculation.start);
    const deductions = Array.isArray(calculation.deductions) ? calculation.deductions.map(Number) : [];
    const expected = Number(calculation.result);
    const actual = start - deductions.reduce((sum, value) => sum + value, 0);
    if (![start, expected, ...deductions].every(Number.isFinite) || Math.abs(actual - expected) > 0.000001) {
      errors.push(`Invalid illustrative calculation: ${calculation.label || "unnamed"}.`);
    }
  }
  const text = flattenStrings(record.channels).join(" ").toLowerCase();
  for (const pattern of claimsPolicy.testimonialPatterns || []) if (text.includes(pattern.toLowerCase())) errors.push(`Invented testimonial pattern detected: ${pattern}.`);
  for (const pattern of claimsPolicy.unsupportedClaimPatterns || []) if (text.includes(pattern.toLowerCase())) errors.push(`Unsupported claim detected: ${pattern}.`);
  if (text.includes("financial advice") && !/(not financial advice|is not financial advice)/i.test(text)) errors.push("ClearTill must not be described as financial advice.");
  return { valid: errors.length === 0, errors };
}

function validateMarketingSystem() {
  const files = [
    "brand/positioning.json", "brand/audiences.json", "brand/voice.json", "brand/claims-policy.json", "brand/product-facts.json",
    "strategy/content-pillars.json", "strategy/objections.json", "strategy/competitors.json", "strategy/experiments.json",
    "calendar/content-calendar.json", "creative/canva-template-registry.json", "creative/canva-generated-designs.json", "creative/infographic-manifest.json", "creative/stock-photo-briefs.json", "creative/stock-photo-candidates.json", "creative/stock-photo-selections.json",
    "assets/asset-register.json", "performance/campaign-results.json", "published/submissions.json",
  ];
  const errors = [];
  for (const relative of files) {
    try {
      const value = readJson(path.join(MARKETING_ROOT, relative));
      if (!value || typeof value !== "object" || Object.keys(value).length === 0) errors.push(`${relative} must contain substantive data.`);
      if (/\b(?:TODO|TBD)\b/i.test(JSON.stringify(value))) errors.push(`${relative} contains a prohibited placeholder.`);
    } catch (error) { errors.push(`${relative}: ${error.message}`); }
  }
  const calendar = loadCalendar();
  if (calendar.timezone !== "Europe/London") errors.push("Content calendar timezone must be Europe/London.");
  if (calendar.posts?.length !== 12) errors.push("The launch calendar must contain exactly 12 master posts.");
  const ids = new Set();
  const variants = { a: 0, b: 0, c: 0 };
  for (const post of calendar.posts || []) {
    const result = validateContentRecord(post);
    errors.push(...result.errors.map((message) => `${post.id || "unknown"}: ${message}`));
    if (ids.has(post.id)) errors.push(`Duplicate content ID: ${post.id}.`);
    ids.add(post.id);
    if (Object.hasOwn(variants, post.messageVariant)) variants[post.messageVariant] += 1;
  }
  for (const [variant, count] of Object.entries(variants)) if (count !== 4) errors.push(`Message variant ${variant} must have four master posts; found ${count}.`);
  const journalDraftDirectory = path.join(MARKETING_ROOT, "drafts/journal");
  for (const filename of fs.existsSync(journalDraftDirectory) ? fs.readdirSync(journalDraftDirectory).filter((name) => name.endsWith(".json")) : []) {
    try {
      const result = validateJournalDraft(readJson(path.join(journalDraftDirectory, filename)));
      errors.push(...result.errors.map((message) => `drafts/journal/${filename}: ${message}`));
    } catch (error) { errors.push(`drafts/journal/${filename}: ${error.message}`); }
  }
  return { valid: errors.length === 0, errors, records: calendar.posts?.length || 0 };
}

function channelDraft(record, channel) {
  if (!SUPPORTED_CHANNELS.has(channel)) throw new Error(`Unsupported channel: ${channel}.`);
  if (record.channels?.[channel]?.enabled === false) throw new Error(`${record.id} is disabled for ${channel}: ${record.channels[channel].disabledReason || "channel decision"}.`);
  const validation = validateContentRecord(record);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  const url = buildCampaignUrl({ landingPath: record.landingPath, utm: record.utm, channel });
  return {
    contentId: record.id,
    channel,
    text: record.channels[channel].text,
    url,
    media: record.channels[channel].media || record.media || null,
    altText: record.altText,
    status: record.status,
    claimsChecked: record.claimsChecked,
    productFactsChecked: record.productFactsChecked,
    dueAt: record.channels[channel].recommendedPublishAt || record.date,
  };
}

module.exports = { MARKETING_ROOT, SUPPORTED_CHANNELS, channelDraft, getContentById, listContent, loadCalendar, validateContentRecord, validateMarketingSystem };
