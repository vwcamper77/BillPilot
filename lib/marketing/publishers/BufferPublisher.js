"use strict";

const path = require("node:path");
const { SocialPublisher } = require("./SocialPublisher");
const { toBufferAsset } = require("../media");
const { SubmissionStore } = require("../submissionStore");

const DEFAULT_API_URL = "https://api.buffer.com";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRIES = 2;
const CHANNEL_ENV = Object.freeze({
  linkedin: "BUFFER_CHANNEL_LINKEDIN",
  facebook: "BUFFER_CHANNEL_FACEBOOK",
  instagram: "BUFFER_CHANNEL_INSTAGRAM",
});

const CREATE_POST = `mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id text status dueAt channelId assets { id mimeType } } }
    ... on MutationError { message }
  }
}`;
const EDIT_POST = `mutation EditPost($input: EditPostInput!) {
  editPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id text status dueAt channelId assets { id mimeType } } }
    ... on MutationError { message }
  }
}`;
const DELETE_POST = `mutation DeletePost($input: DeletePostInput!) {
  deletePost(input: $input) {
    __typename
    ... on DeletePostSuccess { id }
    ... on MutationError { message }
  }
}`;
const GET_CHANNELS = `query GetChannels($input: ChannelsInput!) {
  channels(input: $input) { id name displayName service avatar isQueuePaused }
}`;
const GET_POST = `query GetPost($input: PostInput!) {
  post(input: $input) { id text status dueAt channelId assets { id mimeType } }
}`;
const GET_POST_METRICS = `query GetPostMetrics($input: PostInput!) {
  post(input: $input) { id channelId metrics { type name value unit } metricsUpdatedAt }
}`;

class BufferPublisherError extends Error {
  constructor(message, { code = "BUFFER_ERROR", status = null, retryable = false, details = null } = {}) {
    super(message);
    this.name = "BufferPublisherError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
  toJSON() { return { ok: false, error: { code: this.code, message: this.message, status: this.status, retryable: this.retryable } }; }
}

function redactSecret(value, apiKey) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return text;
  let safe = text.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]");
  if (apiKey) safe = safe.split(apiKey).join("[REDACTED]");
  return safe;
}

class BufferPublisher extends SocialPublisher {
  constructor({
    env = process.env,
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_RETRIES,
    dryRun = false,
    submissionStore,
  } = {}) {
    super();
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.sleep = sleep;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.dryRun = dryRun;
    this.apiUrl = String(env.BUFFER_API_URL || DEFAULT_API_URL).trim();
    this.apiKey = String(env.BUFFER_API_KEY || "").trim();
    this.organizationId = String(env.BUFFER_ORGANIZATION_ID || "").trim();
    this.store = submissionStore || new SubmissionStore(path.resolve(__dirname, "../../../marketing/published/submissions.json"));
  }

  async listChannels() {
    this.#requireConfig(["BUFFER_API_KEY", "BUFFER_ORGANIZATION_ID"]);
    const data = await this.#request(GET_CHANNELS, { input: { organizationId: this.organizationId } });
    return (data.channels || []).map((channel) => ({
      providerChannelId: channel.id,
      channel: String(channel.service || "").toLowerCase(),
      name: channel.displayName || channel.name,
      queuePaused: Boolean(channel.isQueuePaused),
      provider: "buffer",
    }));
  }

  buildCreatePostPayload(content, { draft = true, dueAt = null } = {}) {
    this.#validateContent(content);
    const channelId = this.#channelId(content.channel, content.channelId);
    const assets = content.media ? [toBufferAsset(content.media)] : [];
    const postType = content.media?.type === "video" ? "reel" : "post";
    const metadata = content.channel === "facebook"
      ? { facebook: { type: postType } }
      : content.channel === "instagram"
        ? { instagram: { type: postType, shouldShareToFeed: true } }
        : null;
    const input = {
      text: [String(content.text || "").trim(), String(content.url || "").trim()].filter(Boolean).join("\n\n"),
      channelId,
      schedulingType: "automatic",
      mode: draft ? "addToQueue" : "customScheduled",
      assets,
      ...(metadata ? { metadata } : {}),
      aiAssisted: true,
      source: "cleartill_marketing_system",
      ...(draft ? { saveToDraft: true } : { dueAt: new Date(dueAt).toISOString() }),
    };
    return { query: CREATE_POST, variables: { input } };
  }

  async createDraft(content) {
    let release;
    try {
      release = this.store.acquire(content.contentId, content.channel, "draft");
      const duplicate = this.store.find(content.contentId, content.channel, "draft");
      if (duplicate) throw new BufferPublisherError(`A Buffer draft already exists for ${content.contentId} on ${content.channel}.`, { code: "DUPLICATE_SUBMISSION" });
      const payload = this.buildCreatePostPayload(content, { draft: true });
      if (this.dryRun) return { ok: true, dryRun: true, mode: "draft", payload };
      this.#requireConfig(["BUFFER_API_KEY", CHANNEL_ENV[content.channel]]);
      const post = await this.#create(payload);
      this.store.record({ contentId: content.contentId, channel: content.channel, provider: "buffer", mode: "draft", remotePostId: post.id, submittedAt: this.now().toISOString() });
      return { ok: true, provider: "buffer", mode: "draft", post };
    } finally { release?.(); }
  }

  buildEditPostPayload(content, postId) {
    const created = this.buildCreatePostPayload(content, { draft: true });
    const { channelId: _channelId, ...input } = created.variables.input;
    return { query: EDIT_POST, variables: { input: { ...input, id: String(postId || "").trim() } } };
  }

  async updateDraft(content, postId) {
    const id = String(postId || "").trim();
    if (!id) throw new BufferPublisherError("A Buffer post ID is required to update a draft.", { code: "INVALID_POST_ID" });
    const payload = this.buildEditPostPayload(content, id);
    if (this.dryRun) return { ok: true, dryRun: true, mode: "draft_update", payload };
    this.#requireConfig(["BUFFER_API_KEY", CHANNEL_ENV[content.channel]]);
    const data = await this.#request(payload.query, payload.variables);
    const result = data.editPost;
    if (!result?.post?.id) {
      throw new BufferPublisherError(redactSecret(result?.message || "Buffer rejected the edit mutation.", this.apiKey), { code: "BUFFER_MUTATION_ERROR", retryable: false });
    }
    return { ok: true, provider: "buffer", mode: "draft_update", post: result.post };
  }

  async deleteDraft(postId, { confirmDelete = false } = {}) {
    const id = String(postId || "").trim();
    if (!id) throw new BufferPublisherError("A Buffer post ID is required to delete a draft.", { code: "INVALID_POST_ID" });
    if (!confirmDelete) throw new BufferPublisherError("Deleting a Buffer draft requires explicit confirmation.", { code: "CONFIRMATION_REQUIRED" });
    const existing = await this.getPost(id);
    if (existing?.status !== "draft") throw new BufferPublisherError(`Refusing to delete Buffer post ${id} because its status is ${existing?.status || "unknown"}, not draft.`, { code: "NOT_A_DRAFT" });
    const data = await this.#request(DELETE_POST, { input: { id } });
    const result = data.deletePost;
    if (!result?.id) {
      throw new BufferPublisherError(redactSecret(result?.message || "Buffer rejected the delete mutation.", this.apiKey), { code: "BUFFER_MUTATION_ERROR", retryable: false });
    }
    return { ok: true, provider: "buffer", mode: "draft_delete", postId: result.id };
  }

  async schedulePost(content, dueAt, { confirmPublish = false } = {}) {
    if (String(this.env.CONTENT_LIVE_PUBLISHING_ENABLED || "").toLowerCase() !== "true") {
      throw new BufferPublisherError("Live social publishing is disabled by CONTENT_LIVE_PUBLISHING_ENABLED.", { code: "LIVE_PUBLISHING_DISABLED" });
    }
    if (content.status !== "approved") throw new BufferPublisherError("Live scheduling requires status === approved.", { code: "APPROVAL_REQUIRED" });
    if (content.claimsChecked !== true) throw new BufferPublisherError("Live scheduling requires claimsChecked === true.", { code: "CLAIMS_CHECK_REQUIRED" });
    if (content.productFactsChecked !== true) throw new BufferPublisherError("Live scheduling requires productFactsChecked === true.", { code: "PRODUCT_FACTS_CHECK_REQUIRED" });
    if (!confirmPublish) throw new BufferPublisherError("Live scheduling requires the explicit --confirm-publish flag.", { code: "CONFIRMATION_REQUIRED" });
    const parsedDueAt = new Date(dueAt);
    if (Number.isNaN(parsedDueAt.valueOf())) throw new BufferPublisherError("Schedule date must be a valid ISO date.", { code: "INVALID_SCHEDULE_DATE" });
    if (parsedDueAt <= this.now()) throw new BufferPublisherError("Cannot schedule a post in the past.", { code: "PAST_SCHEDULE_DATE" });
    let release;
    try {
      release = this.store.acquire(content.contentId, content.channel, "scheduled");
      const duplicate = this.store.find(content.contentId, content.channel, "scheduled");
      if (duplicate) throw new BufferPublisherError(`Content ${content.contentId} is already scheduled on ${content.channel}.`, { code: "DUPLICATE_SUBMISSION" });
      const payload = this.buildCreatePostPayload(content, { draft: false, dueAt: parsedDueAt });
      if (this.dryRun) return { ok: true, dryRun: true, mode: "scheduled", payload };
      this.#requireConfig(["BUFFER_API_KEY", CHANNEL_ENV[content.channel]]);
      const post = await this.#create(payload);
      this.store.record({ contentId: content.contentId, channel: content.channel, provider: "buffer", mode: "scheduled", remotePostId: post.id, dueAt: parsedDueAt.toISOString(), submittedAt: this.now().toISOString() });
      return { ok: true, provider: "buffer", mode: "scheduled", post };
    } finally { release?.(); }
  }

  async getPost(postId) {
    this.#requireConfig(["BUFFER_API_KEY"]);
    const data = await this.#request(GET_POST, { input: { id: String(postId || "").trim() } });
    return data.post;
  }

  async getPostMetrics(postId) {
    this.#requireConfig(["BUFFER_API_KEY"]);
    const data = await this.#request(GET_POST_METRICS, { input: { id: String(postId || "").trim() } });
    return { postId: data.post?.id, channelId: data.post?.channelId, metrics: data.post?.metrics || [], metricsUpdatedAt: data.post?.metricsUpdatedAt || null };
  }

  async #create(payload) {
    const data = await this.#request(payload.query, payload.variables);
    const result = data.createPost;
    if (!result?.post?.id) {
      throw new BufferPublisherError(redactSecret(result?.message || "Buffer rejected the post mutation.", this.apiKey), { code: "BUFFER_MUTATION_ERROR", retryable: false });
    }
    return result.post;
  }

  async #request(query, variables, attempt = 0) {
    if (typeof this.fetchImpl !== "function") throw new BufferPublisherError("No fetch implementation is available.", { code: "NETWORK_UNAVAILABLE" });
    const controller = new AbortController();
    let timeout;
    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new BufferPublisherError("Buffer request timed out.", { code: "BUFFER_TIMEOUT", retryable: true }));
      }, this.timeoutMs);
    });
    let response;
    try {
      response = await Promise.race([
        this.fetchImpl(this.apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({ query, variables }),
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof BufferPublisherError) throw error;
      throw new BufferPublisherError(redactSecret(error?.message || "Buffer network request failed.", this.apiKey), { code: "BUFFER_NETWORK_ERROR", retryable: true });
    }
    clearTimeout(timeout);

    const status = Number(response?.status || 0);
    if (status === 429 || status >= 500) {
      if (attempt < this.maxRetries) {
        const retryAfterSeconds = Number(response.headers?.get?.("retry-after") || 0);
        const delay = Math.min(2000, retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 100 * (2 ** attempt));
        await this.sleep(delay);
        return this.#request(query, variables, attempt + 1);
      }
      throw new BufferPublisherError(`Buffer HTTP request failed with status ${status}.`, { code: status === 429 ? "BUFFER_RATE_LIMITED" : "BUFFER_HTTP_ERROR", status, retryable: true });
    }
    if (!response?.ok) {
      throw new BufferPublisherError(`Buffer HTTP request failed with status ${status || "unknown"}.`, { code: status === 401 ? "BUFFER_AUTH_ERROR" : "BUFFER_HTTP_ERROR", status: status || null, retryable: false });
    }
    let body;
    try { body = await response.json(); }
    catch { throw new BufferPublisherError("Buffer returned an invalid JSON response.", { code: "BUFFER_RESPONSE_ERROR", status }); }
    if (Array.isArray(body.errors) && body.errors.length) {
      const first = body.errors[0] || {};
      const code = String(first.extensions?.code || "BUFFER_GRAPHQL_ERROR");
      throw new BufferPublisherError(redactSecret(first.message || "Buffer GraphQL request failed.", this.apiKey), {
        code,
        status,
        retryable: false,
        details: { graphqlCode: code },
      });
    }
    return body.data || {};
  }

  #channelId(channel, explicitId) {
    if (!Object.hasOwn(CHANNEL_ENV, channel)) throw new BufferPublisherError(`Unsupported Buffer channel: ${channel || "missing"}.`, { code: "UNSUPPORTED_CHANNEL" });
    return String(explicitId || this.env[CHANNEL_ENV[channel]] || "").trim();
  }

  #validateContent(content) {
    if (!content?.contentId || !content?.channel || !content?.text) throw new BufferPublisherError("Content requires contentId, channel and text.", { code: "INVALID_CONTENT" });
    if (!Object.hasOwn(CHANNEL_ENV, content.channel)) throw new BufferPublisherError(`Unsupported Buffer channel: ${content.channel}.`, { code: "UNSUPPORTED_CHANNEL" });
    if (!this.#channelId(content.channel, content.channelId)) throw new BufferPublisherError(`Missing ${CHANNEL_ENV[content.channel]}.`, { code: "MISSING_ENV" });
  }

  #requireConfig(names) {
    const missing = names.filter((name) => !String(this.env[name] || "").trim());
    if (missing.length) throw new BufferPublisherError(`Missing Buffer environment variables: ${missing.join(", ")}.`, { code: "MISSING_ENV" });
  }
}

module.exports = {
  BufferPublisher,
  BufferPublisherError,
  CHANNEL_ENV,
  CREATE_POST,
  DELETE_POST,
  EDIT_POST,
  DEFAULT_API_URL,
  GET_CHANNELS,
  GET_POST,
  GET_POST_METRICS,
  redactSecret,
};
