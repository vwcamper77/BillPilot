import crypto from "node:crypto";
import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import {
  createBufferIdea,
  createBufferScheduledPost,
  deleteBufferPost,
  getBufferAccount,
  getBufferChannels,
  getBufferPosts,
} from "@/lib/integrations/buffer.server";
import bufferCore from "@/lib/integrations/bufferCore.cjs";

const {
  bufferOperationKey,
  bufferRuntimeConfig,
  queueCapacity,
  requireFinalArticleUrl,
  socialVariants,
} = bufferCore;

const COLLECTIONS = Object.freeze({
  settings: "seoContentSettings",
  bufferConfig: "seoBufferConfiguration",
  exports: "seoArticleExports",
  publicJournal: "seoPublishedJournal",
  socialItems: "seoSocialDistributionItems",
  operations: "seoBufferOperations",
  metrics: "seoArticleMetrics",
});

const LEASE_MS = 10 * 60 * 1000;

function digest(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function actorRecord(actor) {
  return {
    uid: String(actor?.uid || ""),
    email: String(actor?.email || "").toLowerCase(),
  };
}

async function configuration(db) {
  const [configSnapshot, settingsSnapshot] = await Promise.all([
    db.collection(COLLECTIONS.bufferConfig).doc("default").get(),
    db.collection(COLLECTIONS.settings).doc("default").get(),
  ]);
  return {
    config: configSnapshot.data() || {},
    settings: settingsSnapshot.data() || {},
    runtime: bufferRuntimeConfig(),
  };
}

function requireSyncEnabled(state) {
  if (
    state.runtime.syncEnabled !== true
    || state.settings.bufferSyncEnabled !== true
    || state.config.enabled !== true
  ) {
    const error = new Error("Buffer sync is disabled.");
    error.code = "buffer/sync-disabled";
    throw error;
  }
}

async function claimOperation(db, input, actor, now = new Date()) {
  const key = bufferOperationKey(input);
  const id = digest(key);
  const ref = db.collection(COLLECTIONS.operations).doc(id);
  const leaseId = crypto.randomUUID();
  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.data();
    if (current?.status === "completed") return { claimed: false, current };
    if (
      current?.status === "processing"
      && (current.leaseExpiresAt?.toMillis?.() || 0) > now.getTime()
    ) return { claimed: false, current };
    transaction.set(ref, {
      operationKey: key,
      ...input,
      status: "processing",
      leaseId,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      attempts: Number(current?.attempts || 0) + 1,
      actor: actorRecord(actor),
      createdAt: current?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { claimed: true };
  });
  return { ...result, id, ref, leaseId };
}

async function completeOperation(db, claim, result) {
  await db.runTransaction(async (transaction) => {
    const fresh = await transaction.get(claim.ref);
    if (fresh.data()?.leaseId !== claim.leaseId) throw new Error("Buffer operation lease expired.");
    transaction.update(claim.ref, {
      status: "completed",
      result,
      leaseId: FieldValue.delete(),
      leaseExpiresAt: FieldValue.delete(),
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

async function failOperation(claim, error) {
  await claim.ref.update({
    status: "failed",
    errorCode: error?.code || "buffer/operation-failed",
    safeError: "Buffer could not complete this operation. The article was not changed.",
    leaseId: FieldValue.delete(),
    leaseExpiresAt: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function discoverBufferConfiguration(actor) {
  const db = getAdminDb();
  const accountResult = await getBufferAccount();
  const organisations = accountResult.account?.organizations || [];
  const organisationsWithChannels = [];
  for (const organisation of organisations.slice(0, 10)) {
    const result = await getBufferChannels(organisation.id);
    organisationsWithChannels.push({
      id: organisation.id,
      name: organisation.name,
      channels: result.channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        service: channel.service,
        enabled: false,
      })),
    });
  }
  await db.collection(COLLECTIONS.bufferConfig).doc("default").set({
    discoveredOrganisations: organisationsWithChannels,
    lastCheckedAt: FieldValue.serverTimestamp(),
    rateLimit: accountResult.rateLimit,
    updatedAt: FieldValue.serverTimestamp(),
    checkedBy: actorRecord(actor),
  }, { merge: true });
  return {
    ok: true,
    organisations: organisationsWithChannels,
    channelsAutomaticallySelected: false,
    personalLinkedInAutomaticallyEnabled: false,
  };
}

export async function generateSocialPack({
  articleId,
  versionId,
  actor,
  now = new Date(),
}) {
  const db = getAdminDb();
  const state = await configuration(db);
  const enabledChannels = (state.config.channels || []).filter((channel) => channel.enabled === true);
  if (!enabledChannels.length) {
    const error = new Error("Select at least one Buffer channel first.");
    error.code = "buffer/no-enabled-channels";
    throw error;
  }
  const exportSnapshot = await db.collection(COLLECTIONS.exports).doc(articleId).get();
  const publicationExport = exportSnapshot.data();
  const currentVersion = `v${Number(publicationExport?.version || publicationExport?.versionNumber || 1)}`;
  if (!exportSnapshot.exists || publicationExport.status !== "publication_ready" || currentVersion !== versionId) {
    const error = new Error("An exact approved article version is required.");
    error.code = "buffer/article-not-approved";
    throw error;
  }
  const publicSnapshot = await db.collection(COLLECTIONS.publicJournal)
    .doc(publicationExport.article.slug)
    .get();
  const liveUrl = publicSnapshot.data()?.published === true
    ? `${String(process.env.NEXT_PUBLIC_APP_URL || "https://www.cleartill.money").replace(/\/$/, "")}/blog/${publicationExport.article.slug}`
    : null;
  const variants = socialVariants(publicationExport.article, enabledChannels, {
    liveUrl,
    offsetsDays: state.settings.socialPostTimingOffsetsDays || [0, 4, 28],
  });
  const revision = "social-v1";
  const records = variants.map((variant, index) => ({
    id: digest([
      articleId,
      versionId,
      variant.channelId,
      variant.plannedOffsetDays,
      revision,
    ].join(":")),
    variant,
    index,
  }));
  const existing = records.length
    ? await db.getAll(...records.map((record) => db.collection(COLLECTIONS.socialItems).doc(record.id)))
    : [];
  const existingIds = new Set(existing.filter((item) => item.exists).map((item) => item.id));
  await db.runTransaction(async (transaction) => {
    for (const { id, variant, index } of records) {
      const ref = db.collection(COLLECTIONS.socialItems).doc(id);
      if (!existingIds.has(id)) {
        transaction.create(ref, {
          socialItemId: id,
          articleId,
          versionId,
          channelId: variant.channelId,
          platform: variant.platform,
          copy: variant.copy,
          imageAsset: publicationExport.heroImage?.qa?.passed === true
            ? {
              source: "approved_article_hero",
              heroTitle: publicationExport.heroImage.heroTitle,
              alt: publicationExport.heroImage.alt,
            }
            : null,
          altText: publicationExport.heroImage?.alt || publicationExport.article.description,
          articleUrl: liveUrl,
          plannedPublishDate: null,
          plannedOffsetDays: variant.plannedOffsetDays,
          sequence: index,
          status: "draft",
          bufferId: null,
          bufferStatus: null,
          metrics: null,
          revision,
          generatedAt: FieldValue.serverTimestamp(),
          createdBy: actorRecord(actor),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
  });
  return {
    ok: true,
    articleId,
    versionId,
    generated: variants.length,
    liveUrlAvailable: Boolean(liveUrl),
    bufferCalled: false,
  };
}

export async function approveSocialPack({ articleId, versionId, actor }) {
  const db = getAdminDb();
  const snapshot = await db.collection(COLLECTIONS.socialItems)
    .where("articleId", "==", articleId)
    .where("versionId", "==", versionId)
    .limit(100)
    .get();
  await db.runTransaction(async (transaction) => {
    for (const doc of snapshot.docs) {
      if (doc.data()?.status === "draft") {
        transaction.update(doc.ref, {
          status: "approved",
          approvedAt: FieldValue.serverTimestamp(),
          approvedBy: actorRecord(actor),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
  });
  return { ok: true, approved: snapshot.size };
}

export async function sendSocialItemToBuffer({
  socialItemId,
  action,
  dueAt,
  idempotencyKey = "",
  actor,
}) {
  const db = getAdminDb();
  const state = await configuration(db);
  requireSyncEnabled(state);
  const socialRef = db.collection(COLLECTIONS.socialItems).doc(String(socialItemId || ""));
  const snapshot = await socialRef.get();
  if (!snapshot.exists) throw new Error("Social item not found.");
  const item = snapshot.data();
  if (!["approved", "failed", "buffer_idea_created"].includes(item.status)) {
    throw new Error("Approve the social item before sending it to Buffer.");
  }
  const operationAction = action === "create_idea" ? "create_idea" : "schedule";
  if (operationAction === "schedule") requireFinalArticleUrl(item.articleUrl);
  const operation = {
    articleId: item.articleId,
    versionId: item.versionId,
    action: operationAction,
    channelId: operationAction === "schedule" ? item.channelId : "",
    dueAt: operationAction === "schedule" ? new Date(dueAt).toISOString() : "",
    revision: item.revision,
    idempotencyKey,
  };
  const claim = await claimOperation(db, operation, actor);
  if (!claim.claimed) {
    return {
      ok: true,
      duplicatePrevented: true,
      result: claim.current?.result || null,
    };
  }
  try {
    let result;
    if (operationAction === "create_idea") {
      const idea = await createBufferIdea({
        organizationId: state.config.organisationId,
        title: `ClearTill Journal: ${item.platform}`,
        text: item.copy,
      });
      result = { bufferId: idea.idea.id, status: "buffer_idea_created" };
    } else {
      const scheduledSnapshot = await db.collection(COLLECTIONS.socialItems)
        .where("status", "==", "buffer_scheduled")
        .limit(Number(state.config.queueMaximum || 100) + 1)
        .get();
      const capacity = queueCapacity({
        scheduledCount: scheduledSnapshot.size,
        requestedCount: 1,
        maximum: Number(state.config.queueMaximum || 100),
      });
      if (!capacity.canSchedule) {
        const error = new Error(capacity.warning);
        error.code = "buffer/queue-capacity";
        throw error;
      }
      const post = await createBufferScheduledPost({
        channelId: item.channelId,
        text: item.copy,
        dueAt,
        articleUrl: item.articleUrl,
        imageUrl: item.imageAsset?.url || null,
      });
      result = {
        bufferId: post.post.id,
        status: "buffer_scheduled",
        dueAt: post.post.dueAt,
      };
    }
    await completeOperation(db, claim, result);
    await socialRef.update({
      status: result.status,
      bufferId: result.bufferId,
      bufferStatus: result.status,
      ...(result.dueAt ? { scheduledAt: new Date(result.dueAt) } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await db.collection(COLLECTIONS.metrics).doc("aggregate").set({
      [operationAction === "create_idea" ? "bufferIdeas" : "bufferScheduled"]:
        FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true, duplicatePrevented: false, ...result };
  } catch (error) {
    await failOperation(claim, error);
    await socialRef.update({
      status: "failed",
      bufferStatus: "failed",
      safeError: "Buffer could not complete this operation. The article remains unchanged.",
      updatedAt: FieldValue.serverTimestamp(),
    });
    await db.collection(COLLECTIONS.metrics).doc("aggregate").set({
      bufferFailed: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    throw error;
  }
}

export async function cancelBufferSocialItem({ socialItemId, idempotencyKey = "", actor }) {
  const db = getAdminDb();
  const state = await configuration(db);
  requireSyncEnabled(state);
  const ref = db.collection(COLLECTIONS.socialItems).doc(String(socialItemId || ""));
  const snapshot = await ref.get();
  if (!snapshot.exists || !snapshot.data()?.bufferId) throw new Error("Scheduled Buffer post not found.");
  const item = snapshot.data();
  const claim = await claimOperation(db, {
    articleId: item.articleId,
    versionId: item.versionId,
    action: "cancel",
    channelId: item.channelId,
    dueAt: item.scheduledAt?.toDate?.()?.toISOString?.() || "",
    revision: item.revision,
    idempotencyKey,
  }, actor);
  if (!claim.claimed) return { ok: true, duplicatePrevented: true };
  try {
    const result = await deleteBufferPost(item.bufferId);
    await completeOperation(db, claim, result);
    await ref.update({
      status: "approved",
      bufferStatus: "cancelled",
      bufferId: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, duplicatePrevented: false, ...result };
  } catch (error) {
    await failOperation(claim, error);
    throw error;
  }
}

export async function rescheduleBufferSocialItem({
  socialItemId,
  dueAt,
  idempotencyKey = "",
  actor,
}) {
  const db = getAdminDb();
  const state = await configuration(db);
  requireSyncEnabled(state);
  const ref = db.collection(COLLECTIONS.socialItems).doc(String(socialItemId || ""));
  const snapshot = await ref.get();
  if (!snapshot.exists || !snapshot.data()?.bufferId) {
    throw new Error("Scheduled Buffer post not found.");
  }
  const item = snapshot.data();
  requireFinalArticleUrl(item.articleUrl);
  const exactDueAt = new Date(dueAt);
  if (Number.isNaN(exactDueAt.getTime()) || exactDueAt <= new Date()) {
    throw new TypeError("Choose a future Buffer publication time.");
  }
  const claim = await claimOperation(db, {
    articleId: item.articleId,
    versionId: item.versionId,
    action: "reschedule",
    channelId: item.channelId,
    dueAt: exactDueAt.toISOString(),
    revision: item.revision,
    idempotencyKey,
  }, actor);
  if (!claim.claimed) {
    return { ok: true, duplicatePrevented: true, result: claim.current?.result || null };
  }
  try {
    await deleteBufferPost(item.bufferId);
    const post = await createBufferScheduledPost({
      channelId: item.channelId,
      text: item.copy,
      dueAt: exactDueAt.toISOString(),
      articleUrl: item.articleUrl,
      imageUrl: item.imageAsset?.url || null,
    });
    const result = {
      bufferId: post.post.id,
      status: "buffer_scheduled",
      dueAt: post.post.dueAt,
    };
    await completeOperation(db, claim, result);
    await ref.update({
      status: "buffer_scheduled",
      bufferId: result.bufferId,
      bufferStatus: "buffer_scheduled",
      scheduledAt: new Date(result.dueAt),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, duplicatePrevented: false, ...result };
  } catch (error) {
    await failOperation(claim, error);
    await ref.update({
      status: "failed",
      bufferStatus: "failed",
      safeError: "Buffer could not reschedule this post. The article remains unchanged.",
      updatedAt: FieldValue.serverTimestamp(),
    });
    throw error;
  }
}

export async function syncBufferPostStatuses(actor) {
  const db = getAdminDb();
  const state = await configuration(db);
  requireSyncEnabled(state);
  const channelIds = (state.config.channels || []).filter((item) => item.enabled).map((item) => item.id);
  const [scheduled, sent] = await Promise.all([
    getBufferPosts({
      organizationId: state.config.organisationId,
      channelIds,
      statuses: ["scheduled"],
      first: 100,
    }),
    getBufferPosts({
      organizationId: state.config.organisationId,
      channelIds,
      statuses: ["sent", "error"],
      first: 100,
    }),
  ]);
  const posts = [...(scheduled.posts?.edges || []), ...(sent.posts?.edges || [])]
    .map((edge) => edge.node);
  const byId = new Map(posts.map((post) => [String(post.id), post]));
  const local = await db.collection(COLLECTIONS.socialItems)
    .where("bufferId", "!=", null)
    .limit(100)
    .get();
  const batch = db.batch();
  for (const doc of local.docs) {
    const post = byId.get(String(doc.data().bufferId));
    if (!post) continue;
    batch.update(doc.ref, {
      bufferStatus: post.status,
      status: post.status === "sent"
        ? "promoted"
        : post.status === "error"
          ? "failed"
          : "buffer_scheduled",
      metrics: post.metrics || null,
      ...(post.sentAt ? { publishedAt: new Date(post.sentAt) } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  batch.set(db.collection(COLLECTIONS.bufferConfig).doc("default"), {
    lastSuccessfulSyncAt: FieldValue.serverTimestamp(),
    lastCheckedAt: FieldValue.serverTimestamp(),
    checkedBy: actorRecord(actor),
    rateLimit: scheduled.rateLimit,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();
  return { ok: true, postsRead: posts.length, localItemsChecked: local.size };
}
