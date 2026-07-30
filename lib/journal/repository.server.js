import { getAdminDb } from "@/lib/firebaseAdmin";
import {
  BLOG_POSTS,
  JOURNAL_TOOLS,
  getPostBySlug as getStaticPostBySlug,
} from "@/app/blog/posts";

const PUBLIC_COLLECTION = "seoPublishedJournal";
const PUBLIC_LIMIT = 200;

function firebaseAdminConfigured() {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID
    && (process.env.FIREBASE_ADMIN_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL)
    && (process.env.FIREBASE_ADMIN_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY),
  );
}

function toIso(value) {
  if (!value) return null;
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function publicRecord(snapshot) {
  const data = snapshot.data();
  return {
    ...data.article,
    publishedAt: toIso(data.publishedAt)?.slice(0, 10) || data.article?.publishedAt,
    updatedAt: toIso(data.updatedAt)?.slice(0, 10) || data.article?.updatedAt,
    heroImage: data.heroImage || null,
    publication: {
      articleId: data.articleId,
      versionId: data.versionId,
      source: "firestore",
    },
  };
}

async function readPublishedFirestorePosts() {
  if (!firebaseAdminConfigured()) return [];
  try {
    const snapshot = await getAdminDb().collection(PUBLIC_COLLECTION)
      .where("published", "==", true)
      .orderBy("publishedAt", "desc")
      .limit(PUBLIC_LIMIT)
      .get();
    return snapshot.docs.map(publicRecord);
  } catch (error) {
    console.error("[journal-repository] published read failed", {
      code: error?.code || "unavailable",
    });
    return [];
  }
}

export async function getPublishedJournalPosts() {
  const firestorePosts = await readPublishedFirestorePosts();
  const dynamicSlugs = new Set(firestorePosts.map((post) => post.slug));
  return [
    ...firestorePosts,
    ...BLOG_POSTS.filter((post) => !dynamicSlugs.has(post.slug)),
  ].sort((left, right) => (
    String(right.publishedAt).localeCompare(String(left.publishedAt))
  ));
}

export async function getPublishedJournalPostBySlug(slug) {
  const staticPost = getStaticPostBySlug(slug);
  if (staticPost) return staticPost;
  if (!firebaseAdminConfigured()) return null;
  try {
    const snapshot = await getAdminDb().collection(PUBLIC_COLLECTION).doc(String(slug)).get();
    if (!snapshot.exists || snapshot.data()?.published !== true) return null;
    return publicRecord(snapshot);
  } catch (error) {
    console.error("[journal-repository] post read failed", {
      code: error?.code || "unavailable",
    });
    return null;
  }
}

export async function getRelatedJournalPosts(post, limit = 3) {
  const posts = await getPublishedJournalPosts();
  return posts
    .filter((candidate) => (
      candidate.slug !== post.slug
      && candidate.category === post.category
    ))
    .slice(0, Math.min(6, Math.max(1, Number(limit) || 3)));
}

export async function validateJournalInternalLinks(paths) {
  const posts = await getPublishedJournalPosts();
  const validPaths = new Set([
    "/",
    "/start",
    "/pricing",
    "/blog",
    "/free-cash-position-sheet",
    "/security",
    "/about-cleartill",
    ...BLOG_POSTS.map((post) => `/blog/${post.slug}`),
    ...posts.map((post) => `/blog/${post.slug}`),
    ...JOURNAL_TOOLS.map((tool) => tool.href),
  ]);
  const values = [...new Set((paths || []).map((value) => String(value).trim()).filter(Boolean))];
  const invalid = values.filter((value) => !validPaths.has(value));
  return { passed: invalid.length === 0, paths: values, invalid };
}

export { PUBLIC_LIMIT };
