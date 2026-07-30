import bufferCore from "@/lib/integrations/bufferCore.cjs";

const {
  BUFFER_API_URL,
  requireBufferConfig,
  requireFinalArticleUrl,
} = bufferCore;

const MAX_RETRIES = 2;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response?.headers?.get?.("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 30_000);
  }
  return 500 * (2 ** attempt);
}

function graphQlError(payload, fallback = "Buffer request failed.") {
  const message = payload?.errors?.[0]?.message
    || Object.values(payload?.data || {}).find((value) => value?.message)?.message
    || fallback;
  const error = new Error(String(message).slice(0, 300));
  error.code = "buffer/api-error";
  error.safeMessage = "Buffer could not complete the requested operation.";
  return error;
}

export async function bufferGraphQl(query, variables = {}, {
  fetchImpl = fetch,
  operationName,
} = {}) {
  const { apiKey } = requireBufferConfig();
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetchImpl(BUFFER_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables, operationName }),
        cache: "no-store",
      });
      if (response.status === 429 || response.status >= 500) {
        if (attempt < MAX_RETRIES) {
          await wait(retryDelay(response, attempt));
          continue;
        }
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.errors?.length) {
        const error = graphQlError(payload, `Buffer returned status ${response.status}.`);
        error.status = response.status;
        error.rateLimited = response.status === 429;
        throw error;
      }
      return {
        data: payload.data,
        rateLimit: {
          remaining: response.headers.get("x-ratelimit-remaining"),
          resetAt: response.headers.get("x-ratelimit-reset"),
          limited: false,
        },
      };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES && (error?.status >= 500 || error?.rateLimited)) {
        await wait(500 * (2 ** attempt));
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error("Buffer request failed.");
}

export async function getBufferAccount(options = {}) {
  const result = await bufferGraphQl(`
    query ClearTillBufferAccount {
      account {
        id
        organizations {
          id
          name
        }
      }
    }
  `, {}, { ...options, operationName: "ClearTillBufferAccount" });
  return { account: result.data.account, rateLimit: result.rateLimit };
}

export async function getBufferChannels(organizationId, options = {}) {
  const result = await bufferGraphQl(`
    query ClearTillBufferChannels($organizationId: OrganizationId!) {
      channels(input: { organizationId: $organizationId }) {
        id
        name
        service
      }
    }
  `, { organizationId }, { ...options, operationName: "ClearTillBufferChannels" });
  return { channels: result.data.channels || [], rateLimit: result.rateLimit };
}

export async function createBufferIdea({
  organizationId,
  title,
  text,
}, options = {}) {
  const result = await bufferGraphQl(`
    mutation ClearTillCreateIdea($input: CreateIdeaInput!) {
      createIdea(input: $input) {
        ... on Idea {
          id
          content {
            title
            text
          }
        }
        ... on MutationError {
          message
        }
      }
    }
  `, {
    input: {
      organizationId,
      content: { title, text },
    },
  }, { ...options, operationName: "ClearTillCreateIdea" });
  const idea = result.data.createIdea;
  if (!idea?.id) throw graphQlError(result, idea?.message || "Buffer Idea creation failed.");
  return { idea, rateLimit: result.rateLimit };
}

export async function createBufferScheduledPost({
  channelId,
  text,
  dueAt,
  articleUrl,
  imageUrl = null,
}, options = {}) {
  const liveUrl = requireFinalArticleUrl(articleUrl);
  const scheduledAt = new Date(dueAt);
  if (Number.isNaN(scheduledAt.getTime())) throw new TypeError("Buffer dueAt must be a valid ISO timestamp.");
  const input = {
    text: String(text).replace("[ARTICLE_URL_PENDING]", liveUrl),
    channelId,
    schedulingType: "automatic",
    mode: "customScheduled",
    dueAt: scheduledAt.toISOString(),
    source: "cleartill-seo",
    ...(imageUrl ? { assets: [{ image: { url: imageUrl } }] } : {}),
  };
  const result = await bufferGraphQl(`
    mutation ClearTillCreateScheduledPost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess {
          post {
            id
            text
            dueAt
            channelId
            status
            externalLink
          }
        }
        ... on MutationError {
          message
        }
      }
    }
  `, { input }, { ...options, operationName: "ClearTillCreateScheduledPost" });
  const payload = result.data.createPost;
  if (!payload?.post?.id) throw graphQlError(result, payload?.message || "Buffer scheduling failed.");
  return { post: payload.post, rateLimit: result.rateLimit };
}

export async function getBufferPosts({
  organizationId,
  channelIds = [],
  statuses = ["scheduled"],
  first = 50,
  after = null,
}, options = {}) {
  const result = await bufferGraphQl(`
    query ClearTillBufferPosts(
      $organizationId: OrganizationId!
      $channelIds: [ChannelId!]
      $statuses: [PostStatus!]
      $first: Int
      $after: String
    ) {
      posts(
        first: $first
        after: $after
        input: {
          organizationId: $organizationId
          filter: { status: $statuses, channelIds: $channelIds }
          sort: [{ field: dueAt, direction: asc }, { field: createdAt, direction: desc }]
        }
      ) {
        edges {
          node {
            id
            text
            dueAt
            sentAt
            channelId
            status
            externalLink
            metrics {
              name
              value
              description
            }
            metricsUpdatedAt
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `, {
    organizationId,
    channelIds,
    statuses,
    first: Math.min(100, Math.max(1, Number(first) || 50)),
    after,
  }, { ...options, operationName: "ClearTillBufferPosts" });
  return { posts: result.data.posts, rateLimit: result.rateLimit };
}

export async function deleteBufferPost(postId, options = {}) {
  const result = await bufferGraphQl(`
    mutation ClearTillDeletePost($input: DeletePostInput!) {
      deletePost(input: $input) {
        ... on DeletePostSuccess {
          id
        }
        ... on VoidMutationError {
          message
        }
      }
    }
  `, { input: { id: postId } }, { ...options, operationName: "ClearTillDeletePost" });
  const payload = result.data.deletePost;
  if (!payload?.id) throw graphQlError(result, payload?.message || "Buffer post cancellation failed.");
  return { deletedPostId: payload.id, rateLimit: result.rateLimit };
}
