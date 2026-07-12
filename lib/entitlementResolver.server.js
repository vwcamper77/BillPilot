import { getAdminDb } from "@/lib/firebaseAdmin";
import { getAccessExpiryDate } from "@/lib/billingAccess";

function dateIso(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function statusFor(record, now = new Date()) {
  const recordedStatus = record?.status || record?.accessStatus;
  if (["refunded", "revoked"].includes(recordedStatus)) return recordedStatus;
  const expiresAt = getAccessExpiryDate(record);
  if (expiresAt && expiresAt.getTime() <= now.getTime()) return "expired";
  if (record?.billingMode === "subscription" && ["trialing", "active", "past_due"].includes(record?.subscriptionStatus)) return "active";
  if (["active", "claimed"].includes(recordedStatus)) return "active";
  if (record?.billingMode === "subscription") return "inactive";
  return "pending_claim";
}

export function toAccountBillingResponse(record, accountEmail = null) {
  if (!record) {
    return {
      hasEntitlement: false,
      status: "none",
      planKey: null,
      planName: null,
      accessType: null,
      amountPaidMinor: null,
      currency: "gbp",
      accessStartsAt: null,
      accessExpiresAt: null,
      promotionLabel: null,
      billingEmail: null,
      accountEmail,
      paymentStatus: "none",
      billingMode: null,
      subscriptionStatus: null,
      cancelAtPeriodEnd: false,
    };
  }

  const status = statusFor(record);
  const paymentType = record.paymentType || (record.isQaPurchase || Number(record.amountPaidMinor ?? record.amountPaid) === 0
    ? "promotional"
    : "paid");

  return {
    hasEntitlement: true,
    status,
    planKey: record.planKey || record.plan || (record.billingMode === "subscription" ? "monthly_subscription" : "founding_3_months"),
    planName: record.planName || (record.billingMode === "subscription" ? "ClearTill Monthly" : "Founding Member"),
    accessType: paymentType,
    amountPaidMinor: Number(record.amountPaidMinor ?? record.amountPaid ?? 0),
    currency: String(record.currency || "gbp").toLowerCase(),
    accessStartsAt: dateIso(record.accessStartsAt || record.accessStartedAt),
    accessExpiresAt: dateIso(record.accessExpiresAt || record.accessUntil),
    promotionLabel: record.promotionLabel || record.coupon || null,
    billingEmail: record.checkoutEmail || record.claimedEmail || null,
    accountEmail,
    paymentStatus: status === "active" ? (paymentType === "free" ? "promotional" : paymentType) : status,
    billingMode: record.billingMode || null,
    subscriptionStatus: record.subscriptionStatus || null,
    cancelAtPeriodEnd: Boolean(record.cancelAtPeriodEnd),
    trialEndAt: dateIso(record.trialEndAt),
    currentPeriodEnd: dateIso(record.currentPeriodEnd),
    latestInvoiceStatus: record.latestInvoiceStatus || null,
  };
}

export async function resolveEntitlementForUid(uid, { accountEmail = null } = {}) {
  const db = getAdminDb();
  const canonical = await db.collection("pendingEntitlements")
    .where("uid", "==", uid)
    .limit(10)
    .get();

  if (!canonical.empty) {
    const records = canonical.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    records.sort((a, b) => {
      const activeDifference = Number(statusFor(b) === "active") - Number(statusFor(a) === "active");
      if (activeDifference) return activeDifference;
      const left = new Date(dateIso(a.accessExpiresAt) || 0).getTime();
      const right = new Date(dateIso(b.accessExpiresAt) || 0).getTime();
      return right - left;
    });
    return { source: "canonical", record: records[0], response: toAccountBillingResponse(records[0], accountEmail) };
  }

  // Compatibility path for existing customers. This is read-only and can be
  // removed after the dry-run backfill has been reviewed and applied.
  const legacy = await db.collection("users").doc(uid).collection("settings").doc("billing").get();
  const record = legacy.exists ? legacy.data() : null;
  return { source: record ? "legacy" : "none", record, response: toAccountBillingResponse(record, accountEmail) };
}

export async function hasActiveEntitlement(uid) {
  const resolved = await resolveEntitlementForUid(uid);
  return {
    accessActive: resolved.response.status === "active",
    state: resolved.response.status === "active" ? "access_active"
      : resolved.response.status === "expired" ? "access_expired"
      : resolved.response.status === "refunded" ? "access_refunded"
      : resolved.response.status === "revoked" ? "access_revoked"
      : "access_missing",
    entitlement: resolved.response,
  };
}
