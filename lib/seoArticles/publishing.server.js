import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { getPostBySlug as getStaticJournalPostBySlug } from "@/app/blog/posts";
import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import publicationCore from "@/lib/seoArticles/publicationCore.cjs";

const {
  publicationActionKey,
  publicArticleSnapshot,
  validatePublicationCandidate,
} = publicationCore;

const COLLECTIONS = Object.freeze({
  drafts: "seoArticleDrafts",
  exports: "seoArticleExports",
  publicJournal: "seoPublishedJournal",
  publicVersions: "seoPublishedArticleVersions",
  publicAssets: "seoPublishedJournalAssets",
  publicationActions: "seoPublicationActions",
  transitions: "seoContentTransitions",
  calendar: "seoContentCalendar",
  metrics: "seoArticleMetrics",
  socialItems: "seoSocialDistributionItems",
});

function actionDocumentId(input) {
  return crypto
    .createHash("sha256")
    .update(publicationActionKey(input))
    .digest("hex");
}

function versionDocumentId(articleId, versionId) {
  return `${articleId}__${versionId}`;
}

function publicAssetDocumentId(slug, versionId) {
  return `${slug}__${versionId}`;
}

function actorRecord(actor) {
  return {
    uid: String(actor?.uid || ""),
    email: String(actor?.email || "").trim().toLowerCase(),
  };
}

function transitionDocumentId(actionId) {
  return `publication-${actionId}`;
}

async function revalidateJournal(slug) {
  revalidatePath("/blog");
  revalidatePath(`/blog/${slug}`);
  revalidatePath("/sitemap.xml");
  revalidatePath("/blog/feed.xml");
}

export async function performSeoPublicationAction({
  articleId,
  versionId,
  calendarItemId = "",
  action,
  scheduledFor = "",
  idempotencyKey = "",
  confirm = false,
  actor,
  now = new Date(),
}) {
  const selectedAction = String(action || "");
  if (!["publish_now", "schedule", "pause", "unpublish", "republish"].includes(selectedAction)) {
    throw new TypeError("Choose a valid publication action.");
  }
  if (!articleId || !versionId) throw new TypeError("Article and version are required.");
  if (["publish_now", "unpublish", "republish"].includes(selectedAction) && confirm !== true) {
    const error = new Error("Explicit publication confirmation is required.");
    error.code = "seo/publication-confirmation-required";
    throw error;
  }
  if (selectedAction === "schedule") {
    const date = new Date(scheduledFor);
    if (Number.isNaN(date.getTime()) || date <= now) {
      throw new TypeError("Choose a future publication date.");
    }
  }

  const db = getAdminDb();
  const draftRef = db.collection(COLLECTIONS.drafts).doc(articleId);
  const exportRef = db.collection(COLLECTIONS.exports).doc(articleId);
  const actionId = actionDocumentId({
    articleId,
    versionId,
    action: selectedAction,
    calendarItemId,
    scheduledFor,
    idempotencyKey,
  });
  const actionRef = db.collection(COLLECTIONS.publicationActions).doc(actionId);
  let slug = "";

  const result = await db.runTransaction(async (transaction) => {
    const [existingAction, draftSnapshot, exportSnapshot] = await Promise.all([
      transaction.get(actionRef),
      transaction.get(draftRef),
      transaction.get(exportRef),
    ]);
    if (existingAction.data()?.status === "completed") {
      return { ...existingAction.data(), duplicatePrevented: true };
    }
    const draft = draftSnapshot.data();
    const publicationExport = exportSnapshot.data();
    slug = publicationExport?.article?.slug || "";
    if (!draftSnapshot.exists || !exportSnapshot.exists || !slug) {
      throw new Error("The publication-ready export could not be found.");
    }
    const publicRef = db.collection(COLLECTIONS.publicJournal).doc(slug);
    const publicSnapshot = await transaction.get(publicRef);

    if (selectedAction === "unpublish") {
      if (!publicSnapshot.exists || publicSnapshot.data()?.published !== true) {
        transaction.set(actionRef, {
          articleId,
          versionId,
          action: selectedAction,
          status: "completed",
          duplicatePrevented: true,
          published: false,
          actor: actorRecord(actor),
          completedAt: FieldValue.serverTimestamp(),
        });
        return { published: false, duplicatePrevented: true };
      }
      if (
        publicSnapshot.data()?.articleId !== articleId
        || publicSnapshot.data()?.versionId !== versionId
      ) throw new Error("The live Journal version does not match this request.");
      transaction.update(publicRef, {
        published: false,
        unpublishedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(exportRef, {
        "publication.published": false,
        "publication.unpublishedAt": FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(draftRef, {
        status: "archived",
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(db.collection(COLLECTIONS.metrics).doc("aggregate"), {
        published: FieldValue.increment(-1),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(actionRef, {
        articleId,
        versionId,
        action: selectedAction,
        status: "completed",
        published: false,
        actor: actorRecord(actor),
        completedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(
        db.collection(COLLECTIONS.transitions).doc(transitionDocumentId(actionId)),
        {
          entityId: articleId,
          previousStatus: "published",
          newStatus: "archived",
          actor: actorRecord(actor),
          timestamp: FieldValue.serverTimestamp(),
          articleId,
          versionId,
          safeReason: "Administrator unpublished the public representation without deleting history.",
          sourceAction: "unpublish",
        },
      );
      return { published: false, duplicatePrevented: false };
    }

    const validation = validatePublicationCandidate({
      draft,
      publicationExport,
      versionId,
      existingSlug: getStaticJournalPostBySlug(slug)
        || (publicSnapshot.exists ? publicSnapshot.data() : null),
      now,
    });
    if (!validation.valid) {
      const error = new Error(validation.errors.join(" "));
      error.code = validation.errors.some((item) => /stale/i.test(item))
        ? "seo/stale-version"
        : validation.errors.some((item) => /slug/i.test(item))
          ? "seo/slug-collision"
          : "seo/publication-validation-failed";
      throw error;
    }

    if (selectedAction === "schedule") {
      transaction.update(exportRef, {
        status: "publication_ready",
        "publication.scheduledFor": new Date(scheduledFor),
        "publication.schedulePaused": false,
        "publication.published": false,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(draftRef, {
        status: "scheduled",
        updatedAt: FieldValue.serverTimestamp(),
      });
      const selectedCalendarItemId = calendarItemId || draft.calendarItemId || "";
      if (selectedCalendarItemId) {
        transaction.set(db.collection(COLLECTIONS.calendar).doc(selectedCalendarItemId), {
          articleId,
          versionId,
          status: "scheduled",
          proposedPublicationDate: scheduledFor,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      transaction.set(actionRef, {
        articleId,
        versionId,
        calendarItemId: calendarItemId || null,
        scheduledFor: new Date(scheduledFor),
        action: selectedAction,
        status: "completed",
        published: false,
        actor: actorRecord(actor),
        completedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(
        db.collection(COLLECTIONS.transitions).doc(transitionDocumentId(actionId)),
        {
          entityId: articleId,
          previousStatus: "approved",
          newStatus: "scheduled",
          actor: actorRecord(actor),
          timestamp: FieldValue.serverTimestamp(),
          articleId,
          versionId,
          safeReason: "Publication date explicitly scheduled by an administrator.",
          sourceAction: "schedule_publication",
        },
      );
      return { published: false, scheduled: true, duplicatePrevented: false };
    }

    if (selectedAction === "pause") {
      transaction.update(exportRef, {
        "publication.schedulePaused": true,
        "publication.published": false,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(draftRef, {
        status: "approved",
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(actionRef, {
        articleId,
        versionId,
        action: selectedAction,
        status: "completed",
        published: false,
        actor: actorRecord(actor),
        completedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(
        db.collection(COLLECTIONS.transitions).doc(`${transitionDocumentId(actionId)}-pause`),
        {
          entityId: articleId,
          previousStatus: "scheduled",
          newStatus: "approved",
          actor: actorRecord(actor),
          timestamp: FieldValue.serverTimestamp(),
          articleId,
          versionId,
          safeReason: "Administrator paused the publication schedule.",
          sourceAction: "pause_publication",
        },
      );
      return { published: false, schedulePaused: true, duplicatePrevented: false };
    }

    const immutableId = versionDocumentId(articleId, versionId);
    const immutableRef = db.collection(COLLECTIONS.publicVersions).doc(immutableId);
    const assetId = publicAssetDocumentId(slug, versionId);
    const assetRef = db.collection(COLLECTIONS.publicAssets).doc(assetId);
    const [immutableSnapshot, assetSnapshot] = await Promise.all([
      transaction.get(immutableRef),
      transaction.get(assetRef),
    ]);
    const publishedAt = now.toISOString();
    const snapshot = publicArticleSnapshot({
      draft,
      publicationExport,
      versionId,
      publishedAt,
      actor,
    });
    if (!immutableSnapshot.exists) transaction.create(immutableRef, snapshot);
    if (!assetSnapshot.exists) {
      transaction.create(assetRef, {
        articleId,
        versionId,
        slug,
        mediaType: publicationExport.heroImage.mediaType,
        svg: publicationExport.heroImage.svg,
        pngBase64: publicationExport.heroImage.pngBase64,
        mobilePngBase64: publicationExport.heroImage.mobilePngBase64,
        immutable: true,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.set(publicRef, {
      ...snapshot,
      assetDocumentId: assetId,
      heroImage: {
        src: `/api/journal/assets/${encodeURIComponent(slug)}/${encodeURIComponent(versionId)}/master`,
        mobileSrc: `/api/journal/assets/${encodeURIComponent(slug)}/${encodeURIComponent(versionId)}/mobile`,
        alt: snapshot.hero.alt,
        width: snapshot.hero.width,
        height: snapshot.hero.height,
      },
      published: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(exportRef, {
      "publication.published": true,
      "publication.publishedAt": new Date(publishedAt),
      "publication.liveUrl": `/blog/${slug}`,
      "publication.exportedToLiveCollection": true,
      "publication.approvedVersionId": versionId,
      status: "publication_ready",
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(draftRef, {
      status: "distribution_ready",
      publishedAt: new Date(publishedAt),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (draft.calendarItemId) {
      transaction.set(db.collection(COLLECTIONS.calendar).doc(draft.calendarItemId), {
        articleId,
        versionId,
        status: "published",
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    transaction.set(actionRef, {
      articleId,
      versionId,
      action: selectedAction,
      status: "completed",
      published: true,
      liveUrl: `/blog/${slug}`,
      actor: actorRecord(actor),
      completedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(db.collection(COLLECTIONS.metrics).doc("aggregate"), {
      published: FieldValue.increment(publicSnapshot.data()?.published === true ? 0 : 1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.create(
      db.collection(COLLECTIONS.transitions).doc(transitionDocumentId(actionId)),
      {
        entityId: articleId,
        previousStatus: "publication_ready",
        newStatus: "published",
        actor: actorRecord(actor),
        timestamp: FieldValue.serverTimestamp(),
        articleId,
        versionId,
        safeReason: "Exact approved version published after explicit administrator confirmation.",
        sourceAction: selectedAction,
      },
    );
    transaction.create(
      db.collection(COLLECTIONS.transitions).doc(`${transitionDocumentId(actionId)}-distribution`),
      {
        entityId: articleId,
        previousStatus: "published",
        newStatus: "distribution_ready",
        actor: actorRecord(actor),
        timestamp: FieldValue.serverTimestamp(),
        articleId,
        versionId,
        safeReason: "Published article is ready for separately approved distribution.",
        sourceAction: "prepare_distribution",
      },
    );
    return {
      published: true,
      liveUrl: `/blog/${slug}`,
      duplicatePrevented: publicSnapshot.data()?.published === true,
    };
  });

  if (result.published === true) {
    const socialSnapshot = await db.collection(COLLECTIONS.socialItems)
      .where("articleId", "==", articleId)
      .where("versionId", "==", versionId)
      .limit(100)
      .get();
    if (!socialSnapshot.empty) {
      const batch = db.batch();
      for (const social of socialSnapshot.docs) {
        const publicOrigin = String(
          process.env.NEXT_PUBLIC_APP_URL || "https://www.cleartill.money",
        ).replace(/\/$/, "");
        batch.update(social.ref, {
          articleUrl: `${publicOrigin}/blog/${slug}`,
          "imageAsset.url": `${publicOrigin}/api/journal/assets/${encodeURIComponent(slug)}/${encodeURIComponent(versionId)}/master`,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
  }
  await revalidateJournal(slug);
  return {
    ok: true,
    articleId,
    versionId,
    action: selectedAction,
    ...result,
  };
}
