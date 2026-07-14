/**
 * Pending-entitlement lifecycle for the post-payment-auth founding-member
 * checkout: fulfilment happens against a Stripe Checkout Session with no
 * Firebase UID (Phase A), and is claimed later once the purchaser proves
 * control of the checkout email via Firebase email-link sign-in (Phase B).
 *
 * Design notes (see the plan for the full rationale):
 * - `pendingEntitlements/{stripeCheckoutSessionId}` is the doc — same keying
 *   as the existing `stripeEvents/{sessionId}` dedupe doc, so both Phase A
 *   retries (webhook redelivery, success-page race) and lookups are simple
 *   doc-ID gets, no queries.
 * - The raw claim token is NEVER stored — only `sha256(token)` as
 *   `activeTokenHash`. Resend rotates it (a new random token, new hash),
 *   which also invalidates any previously emailed link.
 * - The checkout email is stored encrypted (existing field-level encryption,
 *   keyed by session ID in place of a user ID since none exists yet) and is
 *   treated as UNVERIFIED until a claim's Firebase ID-token email is
 *   compared against it — it is never called "verified" before that.
 * - Revenue is recorded at Phase A (fulfilment), against a placeholder
 *   `customers/pending_<sessionId>` doc, and merged additively into
 *   `customers/{uid}` at claim — never re-incremented, never overwritten.
 * - Email sends happen outside every Firestore transaction (transactional
 *   outbox: durable state first, side effect after, outcome recorded back).
 */

import { createHash, randomBytes } from "node:crypto";
import {
  FieldValue,
  describeFirestoreAdminError,
  getAdminAuth,
  getAdminDb,
  getFirebaseProjectId,
} from "@/lib/firebaseAdmin";
import { FOUNDING_ACCESS_MONTHS, FOUNDING_PLAN, addMonths } from "@/lib/billingAccess";
import { getCheckoutCoupon } from "@/lib/billingAccess.server";
import { encryptSensitiveValue, decryptSensitiveValue } from "@/lib/security/encryption";
import { FOUNDING_ITEM, sendGa4Event } from "@/lib/analytics/ga4.server";
import { sendAccessLinkEmail } from "@/lib/email/sendAccessLinkEmail.server";
import { getStripeServerClient } from "@/lib/stripe";
import { attributionFromStripeMetadata } from "@/lib/analytics/attribution.server";
import { sendMetaCapiEvent } from "@/lib/analytics/meta.server";
import commercePolicy from "@/lib/billing/commercePolicy.cjs";

/**
 * Re-retrieves the session with `discounts.promotion_code` expanded.
 * Webhook event payloads carry the session as it was when the event fired,
 * without expandable nested fields resolved — using it as-is would make
 * CLEAR100 detection unreliable. Both the webhook and the success page call
 * this before fulfilling, so coupon detection is identical either way.
 */
export async function getExpandedCheckoutSession(sessionId) {
  return getStripeServerClient().checkout.sessions.retrieve(sessionId, {
    expand: ["discounts.promotion_code", "line_items.data.price.product"],
  });
}

const CLAIM_TOKEN_TTL_HOURS = Math.max(1, Math.min(168, Number(process.env.ACCESS_CLAIM_TOKEN_TTL_HOURS) || 24));

export class UnfulfillableSessionError extends Error {
  constructor(sessionId, reason) {
    super(`Checkout session ${sessionId} is not fulfillable (${reason}).`);
    this.name = "UnfulfillableSessionError";
    this.code = "session_not_fulfillable";
  }
}

export class EmailMismatchError extends Error {
  constructor() {
    super("This access link does not match the email used at checkout.");
    this.name = "EmailMismatchError";
    this.code = "email_mismatch";
  }
}

export class EntitlementClaimedError extends Error {
  constructor() {
    super("This access link has already been used.");
    this.name = "EntitlementClaimedError";
    this.code = "already_claimed";
  }
}

export class EntitlementExpiredError extends Error {
  constructor() {
    super("This access link has expired.");
    this.name = "EntitlementExpiredError";
    this.code = "link_expired";
  }
}

export class InvalidClaimTokenError extends Error {
  constructor() {
    super("This access link is not valid.");
    this.name = "InvalidClaimTokenError";
    this.code = "invalid_token";
  }
}

function normaliseEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  return value || null;
}

export function maskEmail(email) {
  const [local, domain] = String(email || "").split("@");
  if (!domain || !local) {
    return "***";
  }
  return `${local.slice(0, 1)}***@${domain}`;
}

export function generateClaimToken() {
  return randomBytes(32).toString("base64url");
}

export function hashClaimToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function entitlementRef(sessionId) {
  return getAdminDb().collection("pendingEntitlements").doc(sessionId);
}

function pendingCustomerRef(sessionId) {
  return getAdminDb().collection("customers").doc(`pending_${sessionId}`);
}

function stripeEventRef(sessionId) {
  return getAdminDb().collection("stripeEvents").doc(sessionId);
}

/**
 * Determines whether a Checkout Session can be fulfilled, and whether it's
 * a genuine paid order or a confirmed CLEAR100 QA order. Stripe reports
 * `payment_status: "no_payment_required"` (not "paid") for a 100%-off
 * session, so a naive `payment_status !== "paid"` check rejects CLEAR100
 * orders outright. Any other unrecognized zero-total session is rejected,
 * not silently treated as QA.
 */
export async function getCheckoutFulfillability(session) {
  const coupon = await getCheckoutCoupon(session);
  const isConfirmedClear100 = coupon === "CLEAR100";
  const amountTotal = Number.isFinite(Number(session.amount_total)) ? Number(session.amount_total) : null;
  const isZeroTotal = amountTotal === 0;
  const isPaid = session.payment_status === "paid";
  const isNoPaymentRequired = session.payment_status === "no_payment_required";

  const currency = String(session.currency || "").toLowerCase();
  const paidPolicy = commercePolicy.classifyOneOff(session);
  const fulfillable = paidPolicy.paid || (currency === "gbp" && session.status === "complete" && isNoPaymentRequired && isZeroTotal && isConfirmedClear100);

  return {
    fulfillable,
    coupon,
    isQaPurchase: isConfirmedClear100 && isZeroTotal,
    amountPaid: amountTotal ?? 0,
    currency,
  };
}

/**
 * Phase A. Idempotent per Stripe Checkout Session ID. Returns a result the
 * caller (webhook / success page) can render from — never the raw claim
 * token, which only ever exists in memory here and in the outbound email.
 */
export async function createPendingEntitlementFromCheckoutSession(session, { webhookEventId = null } = {}) {
  const sessionId = String(session?.id || "").trim();

  if (!sessionId) {
    throw new Error("Missing Stripe Checkout session id.");
  }

  const planMetadata = String(session.metadata?.planKey || session.metadata?.plan || "").trim();
  if (!["founding_member", FOUNDING_PLAN].includes(planMetadata)) {
    throw new UnfulfillableSessionError(sessionId, "unapproved_plan");
  }

  const { fulfillable, coupon, isQaPurchase, amountPaid, currency } = await getCheckoutFulfillability(session);
  const internalTest = String(session.metadata?.internal_test || "") === "1";
  const attribution = attributionFromStripeMetadata(session.metadata);

  if (!fulfillable) {
    throw new UnfulfillableSessionError(sessionId, `status=${session.status} payment_status=${session.payment_status}`);
  }

  const email = normaliseEmail(session.customer_details?.email || session.customer_email);

  if (!email) {
    throw new Error(`Checkout session ${sessionId} has no email to fulfil against.`);
  }

  const db = getAdminDb();
  const entRef = entitlementRef(sessionId);
  const evtRef = stripeEventRef(sessionId);
  const claimToken = generateClaimToken();
  const activeTokenHash = hashClaimToken(claimToken);
  const startedAt = new Date(session.created ? session.created * 1000 : Date.now());
  const accessExpiresAt = addMonths(startedAt, FOUNDING_ACCESS_MONTHS);
  const claimTokenExpiresAt = new Date(Date.now() + CLAIM_TOKEN_TTL_HOURS * 60 * 60 * 1000);
  const maskedEmail = maskEmail(email);

  const outcome = await db.runTransaction(async (transaction) => {
    const [entSnapshot, evtSnapshot] = await Promise.all([
      transaction.get(entRef),
      transaction.get(evtRef),
    ]);

    // The entitlement is the durable fulfilment record. Older deployments
    // could leave a stripeEvents marker behind without the matching
    // entitlement; treating that partial state as complete makes every retry
    // fail at claim time. Heal that state while retaining the existing event
    // marker so revenue/analytics are not counted twice.
    if (entSnapshot.exists) {
      const existing = entSnapshot.exists ? entSnapshot.data() : null;
      return { isNewSession: false, isNewStripeEvent: false, maskedEmail: existing?.maskedEmail || maskedEmail };
    }

    const promotionCode = Array.isArray(session.discounts)
      ? session.discounts.find((item) => item?.promotion_code)?.promotion_code
      : null;
    const promotionCodeId = typeof promotionCode === "string" ? promotionCode : promotionCode?.id || null;
    const couponId = typeof promotionCode === "object" ? promotionCode?.coupon?.id || promotionCode?.promotion?.coupon?.id || null : null;
    const price = session.line_items?.data?.[0]?.price || null;

    transaction.set(entRef, {
      emailEnc: encryptSensitiveValue(email, sessionId),
      maskedEmail,
      checkoutEmail: email,
      activeTokenHash,
      tokenUsedAt: null,
      uid: null,
      stripeCheckoutSessionId: sessionId,
      stripeCustomerId: session.customer ? String(session.customer) : null,
      stripePaymentIntentId: session.payment_intent ? String(session.payment_intent) : null,
      stripeSubscriptionId: session.subscription ? String(session.subscription) : null,
      stripeProductId: typeof price?.product === "string" ? price.product : price?.product?.id || null,
      stripePriceId: price?.id || null,
      stripePromotionCodeId: promotionCodeId,
      stripeCouponId: couponId,
      amountPaid,
      amountPaidMinor: amountPaid,
      currency,
      coupon,
      promotionLabel: coupon,
      isQaPurchase,
      internalTest,
      attribution,
      plan: FOUNDING_PLAN,
      planKey: "founding_member",
      planName: "Founding Member",
      accessSource: isQaPurchase ? "stripe_promotion" : "stripe_paid",
      paymentType: isQaPurchase ? "promotional" : "paid",
      accessStartedAt: startedAt,
      accessStartsAt: startedAt,
      accessExpiresAt,
      accessDurationDays: 90,
      claimTokenExpiresAt,
      status: "pending_claim",
      claimedUid: null,
      claimedEmail: null,
      claimedAt: null,
      webhookEventId,
      emailOutbox: {
        status: "queued",
        attempts: [],
        sendCount: 0,
        firstEmailSentAt: null,
        lastAttemptAt: null,
      },
      gaClientId: String(session.metadata?.gaClientId || "").trim() || null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.set(pendingCustomerRef(sessionId), {
      pendingClaim: true,
      stripeCheckoutSessionId: sessionId,
      stripeCustomerId: session.customer ? String(session.customer) : null,
      stripePaymentIntentId: session.payment_intent ? String(session.payment_intent) : null,
      paymentEmail: email,
      accessType: "founding_member",
      entitlementStatus: "pending_claim",
      reconciliationWarning: "paid_access_not_claimed_no_firebase_uid",
      lastWebhookEventId: webhookEventId,
      currency,
      internalTest,
      excludedFromCommercialReporting: internalTest,
      paymentStatus: internalTest ? "internal" : isQaPurchase ? "qa" : "paid",
      totalPaid: internalTest || isQaPurchase ? 0 : amountPaid,
      subscriptionStatus: "none",
      name: null,
      attribution,
      billsCount: 0,
      onboardingStatus: "not_started",
      dropOffStage: null,
      firstActionAfterSignup: null,
      createdAt: FieldValue.serverTimestamp(),
    });

    transaction.set(evtRef, {
      flow: "public",
      webhookEventId,
      stripeCheckoutSessionId: sessionId,
      coupon,
      isQaPurchase,
      internalTest,
      amountPaid,
      currency,
      ga4EventName: internalTest ? null : isQaPurchase ? "qa_purchase" : "purchase",
      ...(evtSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });

    return { isNewSession: true, isNewStripeEvent: !evtSnapshot.exists, maskedEmail };
  }).catch((error) => {
    throw wrapFirestoreError(error, { sessionId, stage: "create_pending_entitlement" });
  });

  if (outcome.isNewSession) {
    if (outcome.isNewStripeEvent && !internalTest) {
      await Promise.allSettled([sendGa4Event({
        eventName: isQaPurchase ? "qa_purchase" : "purchase",
        clientId: String(session.metadata?.gaClientId || "").trim() || null,
        params: {
          transaction_id: session.stripePaymentIntentId || session.payment_intent || sessionId,
          value: isQaPurchase ? 0 : amountPaid / 100,
          currency: currency.toUpperCase(),
          ...(coupon ? { coupon } : {}),
          ...(isQaPurchase ? { test_flow: true } : {}),
          items: [{ ...FOUNDING_ITEM, price: isQaPurchase ? 0 : amountPaid / 100 }],
        },
      }), ...(isQaPurchase ? [] : [sendMetaCapiEvent({ eventName: "Purchase", eventId: sessionId, attribution, value: amountPaid / 100, currency: "GBP" })])]);
    }

    await attemptSend(sessionId, claimToken, email, accessExpiresAt);
  } else {
    // Retry path: a webhook redelivery or a success-page race landed here
    // after the entitlement already exists. If the original send never
    // succeeded, rotate to a fresh token and try again — we no longer have
    // the original raw token in memory.
    await ensureEmailSent(sessionId).catch((error) => console.error("[entitlements] retry send failed", { sessionId }, error));
  }

  return { sessionId, maskedEmail: outcome.maskedEmail, isNewSession: outcome.isNewSession };
}

async function attemptSend(sessionId, claimToken, email, accessExpiresAt, { allowAlreadySent = false } = {}) {
  const sendId = hashClaimToken(`founding_member_access:${sessionId}:${claimToken}`);
  const reserved = await reserveEmailSend(sessionId, sendId, { allowAlreadySent });
  if (!reserved) return { sent: false, deduplicated: true };

  try {
    const signInUrl = await buildSignInUrl(sessionId, claimToken, email);
    const result = await sendAccessLinkEmail({ to: email, signInUrl, accessExpiresAt, idempotencyKey: sendId });
    await recordEmailOutcome(sessionId, { ok: true, sendId, providerId: result.providerId, skippedReason: result.reason });
    return { sent: true, ...result };
  } catch (error) {
    console.error("[entitlements] access-link email send failed", { sessionId }, error);
    await recordEmailOutcome(sessionId, { ok: false, sendId, error: error?.message || "send failed" });
    return { sent: false, error };
  }
}

async function reserveEmailSend(sessionId, sendId, { allowAlreadySent }) {
  const ref = entitlementRef(sessionId);
  return getAdminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return false;
    const outbox = snapshot.data()?.emailOutbox || {};
    if (outbox.status === "sending") return false;
    if (!allowAlreadySent && (outbox.status === "sent" || outbox.emailSentAt)) return false;

    transaction.set(ref, {
      emailOutbox: {
        ...outbox,
        status: "sending",
        activeSendId: sendId,
        sendReservedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });
}

async function buildSignInUrl(sessionId, claimToken, email) {
  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

  if (!appUrl) {
    throw new Error("Missing NEXT_PUBLIC_APP_URL — required to build the email-link action URL.");
  }

  const continueUrl = `${appUrl}/access/claim?ct=${encodeURIComponent(claimToken)}&sid=${encodeURIComponent(sessionId)}`;

  return getAdminAuth().generateSignInWithEmailLink(email, {
    url: continueUrl,
    handleCodeInApp: true,
  });
}

async function recordEmailOutcome(sessionId, { ok, sendId, providerId = null, skippedReason = null, error }) {
  const ref = entitlementRef(sessionId);
  const attempt = {
    at: new Date().toISOString(),
    ok,
    ...(error ? { error: String(error).slice(0, 300) } : {}),
  };
  let gaClientId = null;

  await getAdminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const data = snapshot.data();
    gaClientId = data?.gaClientId || null;
    const outbox = data?.emailOutbox || {};
    if (outbox.activeSendId !== sendId) return;
    const attempts = Array.isArray(outbox.attempts) ? [...outbox.attempts, attempt].slice(-10) : [attempt];

    transaction.set(ref, {
      emailOutbox: {
        status: ok ? "sent" : "failed",
        attempts,
        sendCount: (Number(outbox.sendCount) || 0) + 1,
        firstEmailSentAt: ok && !outbox.firstEmailSentAt ? FieldValue.serverTimestamp() : (outbox.firstEmailSentAt ?? null),
        emailSentAt: ok ? FieldValue.serverTimestamp() : (outbox.emailSentAt ?? null),
        emailSendId: ok ? sendId : (outbox.emailSendId ?? null),
        providerId: ok ? providerId : (outbox.providerId ?? null),
        skippedReason: ok ? skippedReason : (outbox.skippedReason ?? null),
        activeSendId: null,
        lastAttemptAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  if (ok) {
    const snapshot = await entitlementRef(sessionId).get();
    if (snapshot.data()?.internalTest) return;
    await sendGa4Event({
      eventName: "access_email_sent",
      clientId: gaClientId,
      params: {},
    }).catch((gaError) => console.error("[entitlements] ga4 access_email_sent failed", { sessionId }, gaError));
  }
}

async function ensureEmailSent(sessionId) {
  const snapshot = await entitlementRef(sessionId).get();
  if (!snapshot.exists) return;
  const data = snapshot.data();
  if (!["pending", "pending_claim"].includes(data?.status)) return;
  if (data?.emailOutbox?.status === "sent") return;
  await resendAccessEmail({ sessionId, allowAlreadySent: false });
}

/**
 * Rotates the active claim token and re-sends. Used for explicit
 * user-initiated resends and for internal retry-after-failure. Never
 * touches entitlement `status`, so it can never duplicate access, and it
 * refuses outright once an entitlement is claimed (a claimed entitlement
 * must never re-send a working link).
 */
export async function resendAccessEmail({ sessionId, allowAlreadySent = true }) {
  const { claimToken, email, data } = await rotateClaimToken(sessionId);
  await attemptSend(sessionId, claimToken, email, data.accessExpiresAt, { allowAlreadySent });
  return { maskedEmail: data.maskedEmail };
}

/**
 * Test-only: rotates a fresh claim token and returns the generated sign-in
 * URL directly, without sending it through Resend — lets e2e tests drive
 * the real /access/claim page without needing live email delivery. Only
 * ever reachable via app/api/test-only/access-link/route.js, which is
 * independently gated (NODE_ENV, VERCEL_ENV, and a secret that's simply
 * never set in production).
 */
export async function generateClaimLinkForTesting(sessionId) {
  const { claimToken, email } = await rotateClaimToken(sessionId);
  const signInUrl = await buildSignInUrl(sessionId, claimToken, email);
  return { signInUrl };
}

async function rotateClaimToken(sessionId) {
  const ref = entitlementRef(sessionId);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    throw new InvalidClaimTokenError();
  }

  const data = snapshot.data();

  if (data.status === "claimed" || data.status === "active") {
    throw new EntitlementClaimedError();
  }

  const claimToken = generateClaimToken();
  const activeTokenHash = hashClaimToken(claimToken);
  const claimTokenExpiresAt = new Date(Date.now() + CLAIM_TOKEN_TTL_HOURS * 60 * 60 * 1000);

  await ref.set({
    activeTokenHash,
    claimTokenExpiresAt,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const email = decryptSensitiveValue(data.emailEnc, sessionId);

  return { claimToken, email, data };
}

/**
 * Resolves the checkout email for a claim link, gated purely on the caller
 * proving possession of the correct raw token — the same trust boundary the
 * link itself already relies on. Lets /access/claim sign the visitor in
 * automatically instead of asking them to retype the email Firebase's
 * client-side email-link flow would otherwise require.
 */
export async function resolveClaimEmail({ sessionId, claimToken }) {
  const snapshot = await entitlementRef(sessionId).get();

  if (!snapshot.exists) {
    throw new InvalidClaimTokenError();
  }

  const data = snapshot.data();

  if (!data.activeTokenHash || hashClaimToken(claimToken) !== data.activeTokenHash) {
    throw new InvalidClaimTokenError();
  }

  if (data.claimTokenExpiresAt) {
    const expiresAt = data.claimTokenExpiresAt.toDate ? data.claimTokenExpiresAt.toDate() : new Date(data.claimTokenExpiresAt);
    if (expiresAt.getTime() < Date.now()) {
      throw new EntitlementExpiredError();
    }
  }

  return { email: data.checkoutEmail || decryptSensitiveValue(data.emailEnc, sessionId) };
}

/** Success-page lookup — never returns the encrypted email or token hash. */
export async function getPendingEntitlementBySessionId(sessionId) {
  const snapshot = await entitlementRef(sessionId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  return {
    sessionId,
    maskedEmail: data.maskedEmail,
    status: data.status,
    accessExpiresAt: data.accessExpiresAt,
    isQaPurchase: data.isQaPurchase,
    amountPaid: data.amountPaid,
    currency: data.currency,
  };
}

/**
 * Phase B core transaction. Called by two entry points with different
 * pre-conditions:
 *  - email-link claim: caller has already verified `sha256(claimToken) ===
 *    activeTokenHash` before calling this.
 *  - already-authenticated success-page claim: no token involved — the
 *    security boundary here is purely the email-match check below, gated by
 *    the caller already holding a real Firebase session for `uid`.
 * Either way this function independently re-verifies the email match — it
 * is the actual security boundary, not a formality.
 */
export async function claimPendingEntitlement({ sessionId, uid, verifiedEmail }) {
  const ref = entitlementRef(sessionId);
  const normalisedEmail = normaliseEmail(verifiedEmail);

  const result = await getAdminDb().runTransaction(async (transaction) => {
    const entSnapshot = await transaction.get(ref);

    if (!entSnapshot.exists) {
      throw new InvalidClaimTokenError();
    }

    const entitlement = entSnapshot.data();

    if (entitlement.status === "claimed" || entitlement.status === "active") {
      if ((entitlement.uid || entitlement.claimedUid) === uid) {
        return { alreadyClaimed: true, entitlement };
      }
      throw new EntitlementClaimedError();
    }

    if (entitlement.claimTokenExpiresAt) {
      const expiresAt = entitlement.claimTokenExpiresAt.toDate
        ? entitlement.claimTokenExpiresAt.toDate()
        : new Date(entitlement.claimTokenExpiresAt);
      if (expiresAt.getTime() < Date.now()) {
        throw new EntitlementExpiredError();
      }
    }

    const storedEmail = decryptSensitiveValue(entitlement.emailEnc, sessionId);

    if (!normalisedEmail || normaliseEmail(storedEmail) !== normalisedEmail) {
      throw new EmailMismatchError();
    }

    const userRef = getAdminDb().collection("users").doc(uid);
    const billingRef = userRef.collection("settings").doc("billing");
    const customerRef = getAdminDb().collection("customers").doc(uid);
    const pendingCustomerRef2 = pendingCustomerRef(sessionId);

    const [userSnapshot, customerSnapshot, pendingCustomerSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(customerRef),
      transaction.get(pendingCustomerRef2),
    ]);

    const existingUser = userSnapshot.exists ? userSnapshot.data() : {};
    const existingCustomer = customerSnapshot.exists ? customerSnapshot.data() : {};
    const pendingCustomer = pendingCustomerSnapshot.exists ? pendingCustomerSnapshot.data() : {};

    const accessExpiresAt = entitlement.accessExpiresAt.toDate
      ? entitlement.accessExpiresAt.toDate()
      : new Date(entitlement.accessExpiresAt);
    const existingAccessUntil = existingUser?.accessUntil?.toDate
      ? existingUser.accessUntil.toDate()
      : (existingUser?.accessUntil ? new Date(existingUser.accessUntil) : null);
    const mergedAccessUntil = existingAccessUntil && existingAccessUntil.getTime() > accessExpiresAt.getTime()
      ? existingAccessUntil
      : accessExpiresAt;

    const mergedTotalPaid = (Number(existingCustomer.totalPaid) || 0) + (Number(pendingCustomer.totalPaid) || 0);

    transaction.set(userRef, {
      uid,
      email: normalisedEmail,
      accessStatus: "active",
      accessSource: "stripe",
      accessPlan: "founding",
      accessUntil: mergedAccessUntil,
      stripeCustomerId: entitlement.stripeCustomerId || existingUser?.stripeCustomerId || null,
      stripeCheckoutSessionId: sessionId,
      updatedAt: FieldValue.serverTimestamp(),
      ...(userSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });

    transaction.set(billingRef, {
      plan: FOUNDING_PLAN,
      paid: !entitlement.isQaPurchase && !entitlement.internalTest,
      accessStatus: "active",
      accessSource: "stripe",
      accessStartedAt: entitlement.accessStartedAt,
      accessExpiresAt: mergedAccessUntil,
      accessUntil: mergedAccessUntil,
      stripeCustomerId: entitlement.stripeCustomerId || null,
      stripeCheckoutSessionId: sessionId,
      amountPaid: entitlement.amountPaid,
      currency: entitlement.currency,
      coupon: entitlement.coupon,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    transaction.set(customerRef, {
      uid,
      email: normalisedEmail,
      authenticatedEmail: normalisedEmail,
      paymentEmail: entitlement.checkoutEmail || normalisedEmail,
      stripeCustomerId: entitlement.stripeCustomerId || existingCustomer?.stripeCustomerId || null,
      currency: entitlement.currency,
      internalTest: Boolean(entitlement.internalTest),
      excludedFromCommercialReporting: Boolean(entitlement.internalTest),
      paymentStatus: entitlement.internalTest ? "internal" : entitlement.isQaPurchase ? "qa" : "paid",
      totalPaid: mergedTotalPaid,
      subscriptionStatus: existingCustomer?.subscriptionStatus || "none",
      accessType: "founding_member",
      entitlementStatus: "active",
      stripeCheckoutSessionId: sessionId,
      stripePaymentIntentId: entitlement.stripePaymentIntentId || null,
      lastWebhookEventId: entitlement.webhookEventId || null,
      emailNotificationStatus: entitlement.emailOutbox?.status || "unverifiable",
      emailProviderMessageId: entitlement.emailOutbox?.providerId || null,
      emailType: "founding_member_access",
      lastActiveAt: FieldValue.serverTimestamp(),
      ...(customerSnapshot.exists ? {} : {
        name: null,
        attribution: pendingCustomer?.attribution ?? null,
        billsCount: 0,
        onboardingStatus: "not_started",
        dropOffStage: null,
        firstActionAfterSignup: null,
        createdAt: FieldValue.serverTimestamp(),
      }),
    }, { merge: true });

    if (pendingCustomerSnapshot.exists) {
      transaction.delete(pendingCustomerRef2);
    }

    transaction.set(ref, {
      status: "active",
      uid,
      claimedUid: uid,
      claimedEmail: normalisedEmail,
      claimedAt: FieldValue.serverTimestamp(),
      tokenUsedAt: FieldValue.serverTimestamp(),
      activeTokenHash: null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { alreadyClaimed: false, entitlement: { ...entitlement, accessUntil: mergedAccessUntil } };
  }).catch((error) => {
    if (error instanceof InvalidClaimTokenError
      || error instanceof EntitlementClaimedError
      || error instanceof EntitlementExpiredError
      || error instanceof EmailMismatchError) {
      throw error;
    }
    throw wrapFirestoreError(error, { sessionId, uid, stage: "claim_pending_entitlement" });
  });

  return result;
}

function wrapFirestoreError(error, context) {
  const failure = new Error(describeFirestoreAdminError(error));
  failure.code = error?.code;
  failure.cause = error;
  failure.context = { ...context, firebaseProjectId: getFirebaseProjectId() };
  return failure;
}
