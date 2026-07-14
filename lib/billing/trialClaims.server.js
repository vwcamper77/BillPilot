import { createHash, randomBytes, randomUUID } from "node:crypto";
import { FieldValue, getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { sendEmail } from "@/lib/email/emailService.server";

const CLAIM_TTL_HOURS = Math.max(1, Math.min(168, Number(process.env.TRIAL_CLAIM_TOKEN_TTL_HOURS) || 24));
const CHECKOUT_INTENT_TTL_MINUTES = 24 * 60;
const CLAIM_COLLECTION = "pendingTrialClaims";
const INTENT_COLLECTION = "trialCheckoutIntents";
const COPY_COLLECTIONS = ["settings", "income", "bills", "incomeEvents", "largeCosts", "reminders"];

export class TrialClaimError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TrialClaimError";
    this.code = code;
  }
}

export function normalizeTrialEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new TrialClaimError("invalid_email", "Enter a valid email address.");
  }
  return email;
}

function hashToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function createToken() {
  return randomBytes(32).toString("base64url");
}

function maskEmail(email) {
  const [local, domain] = String(email || "").split("@");
  return local && domain ? `${local.slice(0, 1)}***@${domain}` : "***";
}

function intentRef(checkoutIntentId) {
  return getAdminDb().collection(INTENT_COLLECTION).doc(checkoutIntentId);
}

function claimRef(checkoutIntentId) {
  return getAdminDb().collection(CLAIM_COLLECTION).doc(checkoutIntentId);
}

function asDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  return value instanceof Date ? value : new Date(value);
}

export async function createTrialCheckoutIntent({ anonymousUid, normalizedEmail, internalTest = false, attribution = null }) {
  if (!anonymousUid) throw new TrialClaimError("invalid_owner", "A Firebase session is required.");
  const email = normalizeTrialEmail(normalizedEmail);
  const checkoutIntentId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CHECKOUT_INTENT_TTL_MINUTES * 60 * 1000);

  await intentRef(checkoutIntentId).create({
    checkoutIntentId,
    anonymousUid,
    normalizedEmail: email,
    internalTest: Boolean(internalTest),
    attribution: attribution || null,
    status: "checkout_started",
    checkoutSessionId: null,
    createdAt: now,
    expiresAt,
    updatedAt: now,
  });

  return { checkoutIntentId, normalizedEmail: email };
}

export async function getTrialCheckoutIntent(checkoutIntentId) {
  const id = String(checkoutIntentId || "").trim();
  if (!id) return null;
  const snapshot = await intentRef(id).get();
  return snapshot.exists ? snapshot.data() : null;
}

export async function attachCheckoutSession(checkoutIntentId, checkoutSessionId) {
  await intentRef(checkoutIntentId).set({
    checkoutSessionId,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function createPendingTrialClaim({ session, subscription, stripeEventId }) {
  if (session?.mode !== "subscription") {
    throw new TrialClaimError("invalid_checkout", "Stripe Checkout was not a subscription.");
  }

  const checkoutIntentId = String(session.metadata?.checkoutIntentId || "").trim();
  const anonymousUid = String(session.metadata?.firebaseUid || "").trim();
  if (!checkoutIntentId || !anonymousUid) {
    throw new TrialClaimError("invalid_checkout", "Stripe Checkout is missing trusted ownership metadata.");
  }

  const intentSnapshot = await intentRef(checkoutIntentId).get();
  if (!intentSnapshot.exists) throw new TrialClaimError("invalid_checkout", "Checkout intent was not found.");
  const intent = intentSnapshot.data();
  if ((asDate(intent.expiresAt)?.getTime() || 0) < Date.now()) {
    throw new TrialClaimError("checkout_expired", "Checkout intent expired before Stripe confirmation.");
  }
  const confirmedEmail = normalizeTrialEmail(session.customer_details?.email || session.customer_email);
  if (
    intent.anonymousUid !== anonymousUid
    || intent.checkoutSessionId !== session.id
    || normalizeTrialEmail(intent.normalizedEmail) !== confirmedEmail
    || normalizeTrialEmail(session.metadata?.normalizedEmail) !== confirmedEmail
    || String(subscription.metadata?.firebaseUid || "") !== anonymousUid
    || String(subscription.metadata?.checkoutIntentId || "") !== checkoutIntentId
    || normalizeTrialEmail(subscription.metadata?.normalizedEmail) !== confirmedEmail
  ) {
    throw new TrialClaimError("email_mismatch", "Stripe-confirmed checkout details did not match the checkout intent.");
  }

  if (!subscription || !["trialing", "active"].includes(subscription.status)) {
    throw new TrialClaimError("invalid_subscription", "Stripe did not confirm an active trial or subscription.");
  }

  const rawToken = createToken();
  const claimTokenHash = hashToken(rawToken);
  const claimExpiresAt = new Date(Date.now() + CLAIM_TTL_HOURS * 60 * 60 * 1000);
  const db = getAdminDb();
  const pendingRef = claimRef(checkoutIntentId);

  const result = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(pendingRef);
    if (existing.exists) {
      return { created: false, data: existing.data() };
    }

    const data = {
      checkoutIntentId,
      checkoutSessionId: session.id,
      stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id || "",
      stripeSubscriptionId: subscription.id,
      anonymousUid,
      normalizedEmail: confirmedEmail,
      maskedEmail: maskEmail(confirmedEmail),
      subscriptionStatus: subscription.status,
      trialEndAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
      claimedUid: null,
      claimedAt: null,
      claimStatus: "pending",
      claimTokenHash,
      claimExpiresAt,
      stripeEventId,
      emailOutbox: {
        status: "queued",
        sendCount: 0,
        attempts: [],
        sentAt: null,
      },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    transaction.create(pendingRef, data);
    transaction.set(intentRef(checkoutIntentId), {
      status: "checkout_completed",
      checkoutSessionId: session.id,
      stripeEventId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { created: true, data };
  });

  if (result.created) {
    await sendTrialClaimEmail(checkoutIntentId, rawToken, confirmedEmail);
  } else if (result.data?.emailOutbox?.status !== "sent") {
    await resendTrialClaimEmail({ checkoutIntentId, anonymousUid, internalRetry: true });
  }

  return { checkoutIntentId, maskedEmail: result.data?.maskedEmail || maskEmail(confirmedEmail) };
}

function buildWelcomeEmail(signInUrl) {
  const subject = "Your ClearTill trial is active";
  const copy = "Your 7-day free trial has started. £0 was charged today. Your first £1.99 payment is due after seven days, then monthly unless you cancel.";
  return {
    subject,
    text: `${copy}\n\nOpen ClearTill securely: ${signInUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;color:#0f172a"><p style="font-size:13px;color:#0f766e;text-transform:uppercase">ClearTill</p><h1 style="font-size:22px">${subject}</h1><p style="font-size:15px;line-height:1.6">${copy}</p><p style="margin:24px 0"><a href="${signInUrl}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px">Open ClearTill securely</a></p><p style="font-size:13px;color:#64748b">If you did not request this, you can ignore this email.</p></div>`,
  };
}

async function buildClaimLink(checkoutIntentId, rawToken, email) {
  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (!appUrl) throw new Error("Missing NEXT_PUBLIC_APP_URL.");
  const continueUrl = `${appUrl}/trial/claim?cid=${encodeURIComponent(checkoutIntentId)}&ct=${encodeURIComponent(rawToken)}`;
  return getAdminAuth().generateSignInWithEmailLink(email, { url: continueUrl, handleCodeInApp: true });
}

async function sendTrialClaimEmail(checkoutIntentId, rawToken, email, { allowSent = false } = {}) {
  const sendId = hashToken(`trial_access:${checkoutIntentId}:${rawToken}`);
  const ref = claimRef(checkoutIntentId);
  const reserved = await getAdminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return false;
    const outbox = snapshot.data().emailOutbox || {};
    if (outbox.status === "sending") return false;
    if (!allowSent && (outbox.status === "sent" || outbox.sentAt)) return false;
    transaction.set(ref, {
      emailOutbox: { ...outbox, status: "sending", activeSendId: sendId, reservedAt: FieldValue.serverTimestamp() },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });
  if (!reserved) return { deduplicated: true };

  try {
    const signInUrl = await buildClaimLink(checkoutIntentId, rawToken, email);
    const result = await sendEmail({ to: email, ...buildWelcomeEmail(signInUrl), idempotencyKey: sendId });
    await recordSend(checkoutIntentId, sendId, { ok: true, providerId: result.providerId || null, reason: result.reason || null });
    return { sent: true };
  } catch (error) {
    await recordSend(checkoutIntentId, sendId, { ok: false, error: error?.message || "send failed" });
    return { sent: false };
  }
}

async function recordSend(checkoutIntentId, sendId, outcome) {
  const ref = claimRef(checkoutIntentId);
  await getAdminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const claim = snapshot.data();
    const outbox = claim.emailOutbox || {};
    if (outbox.activeSendId !== sendId) return;
    const attempts = [...(Array.isArray(outbox.attempts) ? outbox.attempts : []), {
      at: new Date().toISOString(),
      ok: outcome.ok,
      ...(outcome.error ? { error: String(outcome.error).slice(0, 250) } : {}),
    }].slice(-10);
    transaction.set(ref, {
      emailOutbox: {
        ...outbox,
        status: outcome.ok ? "sent" : "failed",
        activeSendId: null,
        attempts,
        sendCount: (Number(outbox.sendCount) || 0) + 1,
        sentAt: outcome.ok ? FieldValue.serverTimestamp() : outbox.sentAt || null,
        providerId: outcome.ok ? outcome.providerId : outbox.providerId || null,
        skippedReason: outcome.ok ? outcome.reason : outbox.skippedReason || null,
        lastAttemptAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (claim.anonymousUid) {
      transaction.set(getAdminDb().collection("customers").doc(claim.anonymousUid), {
        emailNotificationStatus: outcome.ok ? "sent" : "failed",
        emailProviderMessageId: outcome.ok ? outcome.providerId || null : null,
        emailType: "trial_access",
        emailNotificationSentAt: outcome.ok ? FieldValue.serverTimestamp() : null,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  });
}

export async function resendTrialClaimEmail({ checkoutIntentId, anonymousUid, internalRetry = false }) {
  const ref = claimRef(checkoutIntentId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new TrialClaimError("invalid_token", "Secure-link request was not found.");
  const claim = snapshot.data();
  if (claim.claimStatus === "claimed") throw new TrialClaimError("already_claimed", "This account is already secured.");
  if (!internalRetry && claim.anonymousUid !== anonymousUid) throw new TrialClaimError("invalid_owner", "This secure-link request belongs to another account.");

  const rawToken = createToken();
  const claimTokenHash = hashToken(rawToken);
  const claimExpiresAt = new Date(Date.now() + CLAIM_TTL_HOURS * 60 * 60 * 1000);
  await ref.set({ claimTokenHash, claimExpiresAt, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await sendTrialClaimEmail(checkoutIntentId, rawToken, claim.normalizedEmail, { allowSent: !internalRetry });
  return { maskedEmail: claim.maskedEmail || maskEmail(claim.normalizedEmail) };
}

export async function resolveTrialClaimEmail({ checkoutIntentId, claimToken }) {
  const snapshot = await claimRef(checkoutIntentId).get();
  if (!snapshot.exists) throw new TrialClaimError("invalid_token", "This secure link is not valid.");
  const claim = snapshot.data();
  if (!claim.claimTokenHash || hashToken(claimToken) !== claim.claimTokenHash) {
    throw new TrialClaimError("invalid_token", "This secure link is not valid.");
  }
  if (claim.claimStatus === "claimed") throw new TrialClaimError("already_claimed", "This secure link has already been used.");
  if ((asDate(claim.claimExpiresAt)?.getTime() || 0) < Date.now()) {
    throw new TrialClaimError("link_expired", "This secure link has expired.");
  }
  return { email: claim.normalizedEmail };
}

async function loadAnonymousDocuments(anonymousUid) {
  const db = getAdminDb();
  const sourceUser = db.collection("users").doc(anonymousUid);
  const groups = await Promise.all(COPY_COLLECTIONS.map(async (collectionName) => {
    const snapshot = await sourceUser.collection(collectionName).get();
    return snapshot.docs
      .filter((document) => !(collectionName === "settings" && document.id === "billing"))
      .map((document) => ({ collectionName, id: document.id, data: document.data() }));
  }));
  return groups.flat();
}

export async function claimTrialSubscription({ checkoutIntentId, claimToken, authenticatedUid, authenticatedEmail }) {
  const verifiedEmail = normalizeTrialEmail(authenticatedEmail);
  const existingSnapshot = await claimRef(checkoutIntentId).get();
  if (existingSnapshot.exists) {
    const existing = existingSnapshot.data();
    if (existing.claimStatus === "claimed" && existing.claimedUid === authenticatedUid && existing.normalizedEmail === verifiedEmail) {
      return {
        alreadyClaimed: true,
        claimedUid: authenticatedUid,
        stripeSubscriptionId: existing.stripeSubscriptionId,
        stripeCustomerId: existing.stripeCustomerId,
      };
    }
  }
  const initial = await resolveTrialClaimEmail({ checkoutIntentId, claimToken });
  if (initial.email !== verifiedEmail) throw new TrialClaimError("email_mismatch", "The signed-in email does not match this secure link.");

  const db = getAdminDb();
  const ref = claimRef(checkoutIntentId);
  const initialSnapshot = await ref.get();
  const initialClaim = initialSnapshot.data();
  const anonymousUid = initialClaim.anonymousUid;
  const documents = anonymousUid === authenticatedUid ? [] : await loadAnonymousDocuments(anonymousUid);
  if (documents.length > 430) throw new TrialClaimError("merge_too_large", "This account needs support to finish securing access.");

  return db.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(ref);
    if (!currentSnapshot.exists) throw new TrialClaimError("invalid_token", "This secure link is not valid.");
    const claim = currentSnapshot.data();
    if (claim.claimStatus === "claimed") {
      if (claim.claimedUid === authenticatedUid) {
        return {
          alreadyClaimed: true,
          claimedUid: authenticatedUid,
          stripeSubscriptionId: claim.stripeSubscriptionId,
          stripeCustomerId: claim.stripeCustomerId,
        };
      }
      throw new TrialClaimError("already_claimed", "This secure link has already been used.");
    }
    if (!claim.claimTokenHash || hashToken(claimToken) !== claim.claimTokenHash) throw new TrialClaimError("invalid_token", "This secure link is not valid.");
    if ((asDate(claim.claimExpiresAt)?.getTime() || 0) < Date.now()) throw new TrialClaimError("link_expired", "This secure link has expired.");
    if (claim.normalizedEmail !== verifiedEmail) throw new TrialClaimError("email_mismatch", "The signed-in email does not match this secure link.");

    const sourceUser = db.collection("users").doc(anonymousUid);
    const targetUser = db.collection("users").doc(authenticatedUid);
    const sourceSubscription = sourceUser.collection("billing").doc("subscription");
    const sourceEntitlement = sourceUser.collection("access").doc("entitlement");
    const targetSubscription = targetUser.collection("billing").doc("subscription");
    const targetEntitlement = targetUser.collection("access").doc("entitlement");
    const sourceCustomer = db.collection("customers").doc(anonymousUid);
    const targetCustomer = db.collection("customers").doc(authenticatedUid);
    const refs = [sourceUser, targetUser, sourceSubscription, sourceEntitlement, targetSubscription, targetEntitlement, sourceCustomer, targetCustomer];
    const targetDocumentRefs = documents.map((document) => targetUser.collection(document.collectionName).doc(document.id));
    const snapshots = await Promise.all([...refs, ...targetDocumentRefs].map((documentRef) => transaction.get(documentRef)));
    const [sourceUserSnapshot, targetUserSnapshot, sourceSubscriptionSnapshot, sourceEntitlementSnapshot, targetSubscriptionSnapshot, , sourceCustomerSnapshot, targetCustomerSnapshot] = snapshots;
    if (!sourceSubscriptionSnapshot.exists || sourceSubscriptionSnapshot.data().stripeSubscriptionId !== claim.stripeSubscriptionId) {
      throw new TrialClaimError("subscription_mismatch", "Subscription ownership could not be verified.");
    }
    if (
      anonymousUid !== authenticatedUid
      && targetSubscriptionSnapshot.exists
      && targetSubscriptionSnapshot.data().stripeSubscriptionId
      && targetSubscriptionSnapshot.data().stripeSubscriptionId !== claim.stripeSubscriptionId
    ) {
      throw new TrialClaimError("subscription_conflict", "This account already has a different subscription.");
    }

    if (anonymousUid !== authenticatedUid) {
      const sourceProfile = sourceUserSnapshot.exists ? sourceUserSnapshot.data() : {};
      const targetProfile = targetUserSnapshot.exists ? targetUserSnapshot.data() : {};
      transaction.set(targetUser, {
        ...sourceProfile,
        ...targetProfile,
        uid: authenticatedUid,
        email: verifiedEmail,
        stripeCustomerId: claim.stripeCustomerId,
        migratedFromAnonymousUid: anonymousUid,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: targetProfile.createdAt || sourceProfile.createdAt || FieldValue.serverTimestamp(),
      }, { merge: true });

      documents.forEach((document, index) => {
        const targetSnapshot = snapshots[refs.length + index];
        if (!targetSnapshot.exists) transaction.set(targetDocumentRefs[index], document.data);
      });
      transaction.set(targetSubscription, {
        ...sourceSubscriptionSnapshot.data(),
        customerEmail: verifiedEmail,
        migratedFromAnonymousUid: anonymousUid,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      if (sourceEntitlementSnapshot.exists) {
        transaction.set(targetEntitlement, {
          ...sourceEntitlementSnapshot.data(),
          migratedFromAnonymousUid: anonymousUid,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      const sourceCustomerData = sourceCustomerSnapshot.exists ? sourceCustomerSnapshot.data() : {};
      const targetCustomerData = targetCustomerSnapshot.exists ? targetCustomerSnapshot.data() : {};
      transaction.set(targetCustomer, {
        ...sourceCustomerData,
        ...targetCustomerData,
        uid: authenticatedUid,
        email: verifiedEmail,
        authenticatedEmail: verifiedEmail,
        paymentEmail: sourceCustomerData.paymentEmail || claim.normalizedEmail,
        stripeCustomerId: claim.stripeCustomerId,
        stripeSubscriptionId: claim.stripeSubscriptionId,
        migratedFromAnonymousUid: anonymousUid,
        createdAt: targetCustomerData.createdAt || sourceCustomerData.createdAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      if (sourceCustomerSnapshot.exists) transaction.delete(sourceCustomer);
      transaction.delete(sourceSubscription);
      if (sourceEntitlementSnapshot.exists) transaction.delete(sourceEntitlement);
      transaction.set(sourceUser, {
        subscriptionClaimedToUid: authenticatedUid,
        subscriptionClaimedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } else {
      transaction.set(sourceUser, {
        uid: authenticatedUid,
        email: verifiedEmail,
        stripeCustomerId: claim.stripeCustomerId,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(sourceSubscription, { customerEmail: verifiedEmail, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      transaction.set(sourceCustomer, {
        uid: authenticatedUid,
        email: verifiedEmail,
        authenticatedEmail: verifiedEmail,
        paymentEmail: claim.normalizedEmail,
        stripeCustomerId: claim.stripeCustomerId,
        stripeSubscriptionId: claim.stripeSubscriptionId,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    transaction.set(ref, {
      claimStatus: "claimed",
      claimedUid: authenticatedUid,
      claimedAt: FieldValue.serverTimestamp(),
      claimTokenHash: null,
      tokenUsedAt: FieldValue.serverTimestamp(),
      audit: {
        anonymousUid,
        permanentUid: authenticatedUid,
        stripeSubscriptionId: claim.stripeSubscriptionId,
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(intentRef(checkoutIntentId), {
      status: "claimed",
      claimedUid: authenticatedUid,
      claimedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return {
      alreadyClaimed: false,
      claimedUid: authenticatedUid,
      stripeSubscriptionId: claim.stripeSubscriptionId,
      stripeCustomerId: claim.stripeCustomerId,
    };
  });
}

export async function getTrialClaimStatus({ uid, checkoutIntentId }) {
  if (!checkoutIntentId) return null;
  const snapshot = await claimRef(checkoutIntentId).get();
  if (!snapshot.exists) return null;
  const claim = snapshot.data();
  if (claim.anonymousUid !== uid && claim.claimedUid !== uid) return null;
  return {
    checkoutIntentId,
    claimStatus: claim.claimStatus,
    maskedEmail: claim.maskedEmail,
    claimedUid: claim.claimedUid || null,
  };
}
