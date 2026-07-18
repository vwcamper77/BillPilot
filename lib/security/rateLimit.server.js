/**
 * Minimal Firestore-backed fixed-window rate limiter.
 *
 * No rate-limiting infrastructure exists elsewhere in this repo. This exists
 * specifically to protect the endpoints the post-payment-auth redesign made
 * reachable without a Firebase-authenticated caller (public checkout, access
 * claim/resend) — server only, no new infra dependency.
 */

import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";

export class RateLimitedError extends Error {
  constructor(bucket) {
    super("Too many requests. Please wait a moment and try again.");
    this.name = "RateLimitedError";
    this.code = "rate_limited";
    this.bucket = bucket;
  }
}

function windowStart(windowSeconds) {
  const windowMs = windowSeconds * 1000;
  return Math.floor(Date.now() / windowMs) * windowMs;
}

/**
 * Throws RateLimitedError if `key` has exceeded `max` calls within the
 * current fixed window for `bucket`. Fixed windows (not sliding) are a
 * deliberate simplification — the abuse this guards against (bulk checkout
 * creation, email-bombing a claim link) doesn't need sub-window precision.
 */
export async function checkRateLimit(bucket, key, { max, windowSeconds }) {
  const start = windowStart(windowSeconds);
  const docId = `${bucket}:${key}:${start}`;
  const ref = getAdminDb().collection("rateLimits").doc(docId);

  const result = await getAdminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? Number(snapshot.data()?.count) || 0 : 0;

    if (current >= max) {
      return { allowed: false, count: current };
    }

    transaction.set(
      ref,
      {
        bucket,
        count: FieldValue.increment(1),
        windowStart: start,
        updatedAt: FieldValue.serverTimestamp(),
        ...(snapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    );

    return { allowed: true, count: current + 1 };
  });

  if (!result.allowed) {
    throw new RateLimitedError(bucket);
  }
}

/** Best-effort caller IP extraction (Vercel sets x-forwarded-for). */
export function getRequestIp(request) {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  return forwardedFor.split(",")[0]?.trim() || "unknown";
}
