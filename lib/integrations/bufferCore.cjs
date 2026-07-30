"use strict";

const BUFFER_API_URL = "https://api.buffer.com";
const PERSONAL_LINKEDIN_PATTERN = /\b(personal|profile|member)\b/i;

function bufferRuntimeConfig(env = process.env) {
  return {
    apiKey: String(env.BUFFER_API_KEY || "").trim(),
    syncEnabled: String(env.BUFFER_SYNC_ENABLED || "").trim().toLowerCase() === "true",
  };
}

function requireBufferConfig(env = process.env) {
  const config = bufferRuntimeConfig(env);
  if (!config.apiKey) {
    const error = new Error("BUFFER_API_KEY is not configured.");
    error.code = "buffer/misconfigured";
    throw error;
  }
  return config;
}

function isPersonalLinkedInChannel(channel) {
  return String(channel?.service || "").toLowerCase() === "linkedin"
    && (
      channel?.isPersonal === true
      || PERSONAL_LINKEDIN_PATTERN.test(String(channel?.channelType || channel?.type || ""))
      || PERSONAL_LINKEDIN_PATTERN.test(String(channel?.label || channel?.name || ""))
    );
}

function selectableChannels(channels, explicitlyEnabledIds = []) {
  const enabled = new Set(explicitlyEnabledIds.map(String));
  return (channels || []).map((channel) => ({
    ...channel,
    selected: enabled.has(String(channel.id)),
    requiresExplicitPersonalLinkedInApproval: isPersonalLinkedInChannel(channel),
  }));
}

function validateChannelSelection(channels, selectedIds, {
  explicitlyApprovedPersonalLinkedInIds = [],
} = {}) {
  const byId = new Map((channels || []).map((channel) => [String(channel.id), channel]));
  const approvedPersonal = new Set(explicitlyApprovedPersonalLinkedInIds.map(String));
  const errors = [];
  for (const id of selectedIds || []) {
    const channel = byId.get(String(id));
    if (!channel) errors.push(`Unknown Buffer channel ${id}.`);
    else if (isPersonalLinkedInChannel(channel) && !approvedPersonal.has(String(id))) {
      errors.push(`Personal LinkedIn channel ${id} requires explicit administrator approval.`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function bufferOperationKey({
  articleId,
  versionId,
  action,
  channelId = "",
  dueAt = "",
  revision = "v1",
  idempotencyKey = "",
}) {
  return [
    articleId,
    versionId,
    action,
    channelId,
    dueAt,
    revision,
    idempotencyKey,
  ].map(String).join(":");
}

function requireFinalArticleUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("A final live article URL is required before Buffer scheduling.");
  }
  if (!/^https:$/.test(url.protocol) || /placeholder|example\./i.test(url.hostname + url.pathname)) {
    throw new Error("A final live article URL is required before Buffer scheduling.");
  }
  return url.toString();
}

function queueCapacity({ scheduledCount = 0, requestedCount = 0, maximum = 100 } = {}) {
  const remaining = Math.max(0, Number(maximum) - Number(scheduledCount));
  return {
    scheduledCount: Number(scheduledCount),
    requestedCount: Number(requestedCount),
    maximum: Number(maximum),
    remaining,
    canSchedule: requestedCount <= remaining,
    warning: requestedCount > remaining
      ? `Buffer queue capacity is ${remaining}; ${requestedCount} posts were requested.`
      : null,
  };
}

function socialVariants(article, channels, {
  liveUrl = null,
  offsetsDays = [0, 4, 28],
} = {}) {
  const supported = new Set(["linkedin", "facebook", "instagram", "twitter", "x", "threads", "pinterest"]);
  return (channels || [])
    .filter((channel) => channel.enabled === true && supported.has(String(channel.service).toLowerCase()))
    .flatMap((channel) => offsetsDays.map((offset, index) => {
      const service = String(channel.service).toLowerCase();
      const urlText = liveUrl || "[ARTICLE_URL_PENDING]";
      const lead = index === 0
        ? `New from the ClearTill Journal: ${article.title}`
        : index === 1
          ? `One useful idea from our guide: ${article.takeaway || article.description}`
          : `Worth revisiting: ${article.title}`;
      const copy = service === "twitter" || service === "x"
        ? `${lead.slice(0, 220)} ${urlText}`
        : `${lead}\n\n${article.description}\n\n${urlText}`;
      return {
        channelId: channel.id,
        platform: service,
        copy,
        plannedOffsetDays: offset,
        status: "draft",
      };
    }));
}

module.exports = {
  BUFFER_API_URL,
  bufferOperationKey,
  bufferRuntimeConfig,
  isPersonalLinkedInChannel,
  queueCapacity,
  requireBufferConfig,
  requireFinalArticleUrl,
  selectableChannels,
  socialVariants,
  validateChannelSelection,
};
