"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { MARKETING_ROOT } = require("./content");

const BRIEFS_PATH = path.join(MARKETING_ROOT, "creative/stock-photo-briefs.json");
const CANDIDATES_PATH = path.join(MARKETING_ROOT, "creative/stock-photo-candidates.json");
const ASSET_REGISTER_PATH = path.join(MARKETING_ROOT, "assets/asset-register.json");
const STOCK_ASSET_ROOT = path.join(MARKETING_ROOT, "assets/stock");
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
function safeHttps(value, field) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch { throw new Error(`Pixabay returned an invalid ${field}.`); }
}
function cleanCreatorSlug(value) {
  return String(value || "creator").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "creator";
}
function assessCandidateRisk(candidate) {
  const tags = new Set((candidate.tags || []).map((tag) => String(tag).toLowerCase()));
  const hasAny = (values) => values.some((value) => tags.has(value));
  const riskFlags = [];
  if (hasAny(["apple", "ipad", "iphone", "mac", "macbook", "macbook pro"])) riskFlags.push("recognisable technology brand or product may be visible");
  if (hasAny(["bank", "banking", "contract", "financial documents", "document", "screen"])) riskFlags.push("screen or document content needs inspection");
  if (hasAny(["woman", "man", "people", "businessman", "businesswoman"])) riskFlags.push("recognisable person may require sensitive-context review");
  if (hasAny(["rupee", "indian currency", "euro", "dollar", "irs"])) riskFlags.push("currency or tax context may be unsuitable for a UK campaign");
  return { automatedRiskFlags: riskFlags, selectionStatus: riskFlags.length ? "needs_caution" : "candidate_for_visual_review" };
}
function normalizePixabayHit(hit, { query, licenceUrl }) {
  const id = Number(hit?.id);
  const width = Number(hit?.imageWidth);
  const height = Number(hit?.imageHeight);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(width) || !Number.isInteger(height)) throw new Error("Pixabay returned an invalid image record.");
  const creator = String(hit.user || "Unknown contributor").trim();
  const downloadUrl = hit.largeImageURL || hit.fullHDURL || hit.imageURL;
  const candidate = {
    providerAssetId: String(id),
    query,
    sourceUrl: safeHttps(hit.pageURL, "source page URL"),
    previewUrl: safeHttps(hit.webformatURL || hit.previewURL, "preview URL"),
    temporaryDownloadUrl: safeHttps(downloadUrl, "download URL"),
    width,
    height,
    tags: String(hit.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
    creator,
    creatorProfileUrl: Number.isInteger(Number(hit.user_id)) && Number(hit.user_id) > 0
      ? `https://pixabay.com/users/${cleanCreatorSlug(creator)}-${Number(hit.user_id)}/`
      : null,
    licence: "Pixabay Content License",
    licenceUrl,
    attributionRequired: false,
    suggestedCredit: `Photo by ${creator} via Pixabay`,
    rightsChecks: {
      licenceChecked: false,
      modelOrPropertyReleaseChecked: false,
      trademarkRiskChecked: false,
      sensitiveContextChecked: false
    }
  };
  return { ...candidate, ...assessCandidateRisk(candidate) };
}

function decorateCandidates(result) {
  for (const campaign of Object.values(result.campaigns || {})) {
    campaign.candidates = (campaign.candidates || []).map((candidate) => ({ ...candidate, ...assessCandidateRisk(candidate) }));
  }
  return result;
}

class PixabayClient {
  constructor({ apiKey = process.env.PIXABAY_API_KEY, fetchImpl = globalThis.fetch, endpoint = "https://pixabay.com/api/" } = {}) {
    this.apiKey = String(apiKey || "").trim();
    this.fetch = fetchImpl;
    this.endpoint = endpoint;
  }

  async search(query, options = {}) {
    if (!this.apiKey) throw Object.assign(new Error("PIXABAY_API_KEY is not configured."), { code: "PIXABAY_API_KEY_MISSING" });
    if (typeof this.fetch !== "function") throw new Error("A fetch implementation is required.");
    const searchTerm = String(query || "").trim();
    if (searchTerm.length > 100) throw new Error("Pixabay search queries may not exceed 100 characters.");
    const url = new URL(this.endpoint);
    const values = {
      key: this.apiKey,
      q: searchTerm,
      image_type: options.imageType || "photo",
      orientation: options.orientation || "horizontal",
      safesearch: String(options.safeSearch !== false),
      lang: options.language || "en",
      min_width: String(options.minimumWidth || 1600),
      min_height: String(options.minimumHeight || 900),
      per_page: String(options.perPage || 6),
      order: "popular"
    };
    for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
    const response = await this.fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Object.assign(new Error(`Pixabay search failed with HTTP ${response.status}.`), { code: "PIXABAY_HTTP_ERROR", status: response.status });
    return response.json();
  }
}

async function buildPhotoCandidates({ ids, apiKey, fetchImpl, now = new Date(), briefs = readJson(BRIEFS_PATH) } = {}) {
  const selectedIds = ids?.length ? ids : Object.keys(briefs.campaigns);
  const client = new PixabayClient({ apiKey, fetchImpl, endpoint: briefs.provider.apiUrl });
  const generatedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + Number(briefs.provider.cacheHours || 24) * 3600000).toISOString();
  const campaigns = {};
  for (const id of selectedIds) {
    const brief = briefs.campaigns[id];
    if (!brief) throw new Error(`No stock-photo brief exists for ${id}.`);
    if (!brief.query) {
      campaigns[id] = { status: "not_required", role: brief.role, query: null, composition: brief.composition, avoid: brief.avoid, candidates: [] };
      continue;
    }
    const result = await client.search(brief.query, briefs.defaults);
    campaigns[id] = {
      status: result.hits?.length ? "candidates_for_review" : "no_results",
      role: brief.role,
      query: brief.query,
      composition: brief.composition,
      avoid: brief.avoid,
      totalHits: Number(result.totalHits || 0),
      candidates: (result.hits || []).map((hit) => normalizePixabayHit(hit, { query: brief.query, licenceUrl: briefs.provider.licenceUrl }))
    };
  }
  return {
    schemaVersion: "stock-photo-candidates-v1",
    provider: briefs.provider.name,
    generatedAt,
    expiresAt,
    status: "candidates_for_review",
    message: briefs.provider.productionRule,
    campaigns
  };
}

function reusableCandidates(ids, { now = new Date(), candidatesPath = CANDIDATES_PATH, briefs = readJson(BRIEFS_PATH) } = {}) {
  if (!fs.existsSync(candidatesPath)) return null;
  const candidates = readJson(candidatesPath);
  if (candidates.status !== "candidates_for_review" || !candidates.expiresAt || Date.parse(candidates.expiresAt) <= now.getTime()) return null;
  return ids.every((id) => candidates.campaigns?.[id] && candidates.campaigns[id].query === (briefs.campaigns?.[id]?.query ?? null)) ? candidates : null;
}

function findCandidate(candidates, contentId, providerAssetId) {
  return candidates?.campaigns?.[contentId]?.candidates?.find((item) => item.providerAssetId === String(providerAssetId)) || null;
}

async function downloadCandidate({ contentId, providerAssetId, fetchImpl = globalThis.fetch, now = new Date(), candidates = readJson(CANDIDATES_PATH) } = {}) {
  if (Date.parse(candidates.expiresAt) <= now.getTime()) throw new Error("Stock-photo candidates have expired; refresh the Pixabay search before downloading.");
  const candidate = findCandidate(candidates, contentId, providerAssetId);
  if (!candidate) throw new Error(`Unknown Pixabay candidate ${providerAssetId} for ${contentId}.`);
  const response = await fetchImpl(candidate.temporaryDownloadUrl, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Pixabay image download failed with HTTP ${response.status}.`);
  const contentType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  const extension = extensions[contentType];
  if (!extension) throw new Error(`Unsupported Pixabay image content type: ${contentType || "missing"}.`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_DOWNLOAD_BYTES) throw new Error("Pixabay image is empty or exceeds the 25 MB limit.");
  const filename = `${contentId}-pixabay-${candidate.providerAssetId}.${extension}`;
  const destination = path.join(STOCK_ASSET_ROOT, filename);
  fs.mkdirSync(STOCK_ASSET_ROOT, { recursive: true });
  fs.writeFileSync(destination, buffer);
  const register = readJson(ASSET_REGISTER_PATH);
  const assetId = `pixabay-${candidate.providerAssetId}-${contentId}`;
  register.assets = (register.assets || []).filter((asset) => asset.assetId !== assetId);
  register.assets.push({
    assetId,
    contentId,
    type: "stock_photo",
    sourceProvider: "pixabay",
    providerAssetId: candidate.providerAssetId,
    sourceUrl: candidate.sourceUrl,
    creator: candidate.creator,
    creatorProfileUrl: candidate.creatorProfileUrl,
    licence: candidate.licence,
    licenceUrl: candidate.licenceUrl,
    downloadedAt: now.toISOString(),
    localPath: path.relative(path.resolve(MARKETING_ROOT, ".."), destination),
    originalFilename: filename,
    canvaDesignUrl: null,
    modifications: null,
    attributionRequired: candidate.attributionRequired,
    publicAttribution: candidate.suggestedCredit,
    modelOrPropertyReleaseChecked: false,
    trademarkRiskChecked: false,
    sensitiveContextChecked: false,
    licenceChecked: false,
    humanApproved: false,
    approvedBy: null,
    approvedAt: null
  });
  writeJson(ASSET_REGISTER_PATH, register);
  return { assetId, destination, record: register.assets.at(-1) };
}

module.exports = {
  ASSET_REGISTER_PATH,
  BRIEFS_PATH,
  CANDIDATES_PATH,
  PixabayClient,
  assessCandidateRisk,
  buildPhotoCandidates,
  decorateCandidates,
  downloadCandidate,
  findCandidate,
  normalizePixabayHit,
  reusableCandidates,
  writeJson
};
