"use strict";

const MEDIA_TYPES = new Set(["image", "video", "document", "link"]);

function safePublicUrl(value, label = "Media") {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must use a valid public HTTPS URL.`); }
  if (url.protocol !== "https:") throw new Error(`${label} must use a public HTTPS URL.`);
  if (/^(drive\.google\.com|docs\.google\.com|dropbox\.com|www\.dropbox\.com)$/i.test(url.hostname)) {
    throw new Error("Share-page URLs are not production media URLs. Use a stable direct public file URL.");
  }
  return url.toString();
}

function normalizeMedia(media) {
  if (!media) return null;
  if (!MEDIA_TYPES.has(media.type)) throw new Error(`Unsupported media type: ${media.type || "missing"}.`);
  const url = new URL(safePublicUrl(media.url));

  const normalized = {
    type: media.type,
    url: url.toString(),
    altText: String(media.altText || "").trim(),
  };
  if (media.type === "video" && media.thumbnailUrl) normalized.thumbnailUrl = safePublicUrl(media.thumbnailUrl, "Video thumbnail");
  if (media.width != null || media.height != null) {
    const width = Number(media.width);
    const height = Number(media.height);
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new Error("Media dimensions must be positive integer width and height values.");
    }
    normalized.dimensions = { width, height };
  }
  if (media.type === "image" && !normalized.altText) throw new Error("Image media requires alt text.");
  if (media.type === "document") {
    normalized.title = String(media.title || "").trim();
    normalized.thumbnailUrl = String(media.thumbnailUrl || "").trim();
    if (!normalized.title || !normalized.thumbnailUrl) throw new Error("Document media requires a title and public thumbnailUrl.");
  }
  return normalized;
}

function toBufferAsset(media) {
  const item = normalizeMedia(media);
  if (!item) return null;
  if (item.type === "image") {
    return { image: { url: item.url, metadata: { altText: item.altText, ...(item.dimensions ? { dimensions: item.dimensions } : {}) } } };
  }
  // Buffer rejects custom video thumbnail URLs. Pick the opening frame instead;
  // the source thumbnail remains available to the human review workflow.
  if (item.type === "video") return { video: { url: item.url, metadata: { thumbnailOffset: 0 } } };
  if (item.type === "document") return { document: { url: item.url, title: item.title, thumbnailUrl: item.thumbnailUrl } };
  return { link: { url: item.url } };
}

module.exports = { MEDIA_TYPES, normalizeMedia, toBufferAsset };
