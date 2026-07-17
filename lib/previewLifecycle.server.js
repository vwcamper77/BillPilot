import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import { calculateDashboard } from "@/lib/billMath";
import previewPolicy from "@/lib/previewPolicy.cjs";

const { asDate, normalizePreviewRecord } = previewPolicy;

export const PREVIEW_DURATION_DAYS = 7;
export const PREVIEW_DURATION_MS = PREVIEW_DURATION_DAYS * 24 * 60 * 60 * 1000;

export { normalizePreviewRecord };

export function hasCompletePosition({ balance, income, bills = [], largeCosts = [] } = {}) {
  const validBalance = balance?.currentBalance !== null
    && balance?.currentBalance !== undefined
    && Number.isFinite(Number(balance.currentBalance));
  const payDay = Number(income?.payDay);
  const validPayday = Number.isInteger(payDay) && payDay >= 1 && payDay <= 31;
  const hasCost = [...bills, ...largeCosts].some((item) => item?.active !== false && Number(item?.amount) > 0);
  return {
    complete: validBalance && validPayday && hasCost,
    validBalance,
    validPayday,
    hasCost,
  };
}

export async function inspectCompletePosition(uid, { transaction = null } = {}) {
  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);
  const refs = [
    userRef.collection("settings").doc("balance"),
    userRef.collection("income").doc("main"),
    userRef.collection("bills").where("active", "==", true),
    userRef.collection("largeCosts").where("active", "==", true),
  ];
  const read = (ref) => transaction ? transaction.get(ref) : ref.get();
  const [balanceSnap, incomeSnap, billsSnap, costsSnap] = await Promise.all(refs.map(read));
  const balance = balanceSnap.exists ? balanceSnap.data() : null;
  const income = incomeSnap.exists ? incomeSnap.data() : null;
  const bills = billsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const largeCosts = costsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const completeness = hasCompletePosition({ balance, income, bills, largeCosts });
  const result = completeness.complete ? calculateDashboard(bills, income, balance) : null;
  return { ...completeness, balance, income, bills, largeCosts, result };
}

export async function startPreviewForUid(uid, { now = new Date() } = {}) {
  const db = getAdminDb();
  const previewRef = db.collection("users").doc(uid).collection("access").doc("preview");
  const onboardingRef = db.collection("users").doc(uid).collection("access").doc("onboarding");
  const endsAt = new Date(now.getTime() + PREVIEW_DURATION_MS);

  return db.runTransaction(async (transaction) => {
    const existingSnap = await transaction.get(previewRef);
    if (existingSnap.exists) {
      return { created: false, preview: normalizePreviewRecord(existingSnap.data(), now) };
    }

    const position = await inspectCompletePosition(uid, { transaction });
    if (!position.complete || !position.result) {
      const error = new Error("Complete your balance, payday and at least one upcoming cost before starting the preview.");
      error.code = "preview/incomplete-position";
      error.completeness = {
        validBalance: position.validBalance,
        validPayday: position.validPayday,
        hasCost: position.hasCost,
      };
      throw error;
    }

    const record = {
      status: "active",
      startedAt: now,
      endsAt,
      durationDays: PREVIEW_DURATION_DAYS,
      source: "first_complete_position",
      remindersEnabled: true,
      includeAmountsInEmail: false,
      convertedAt: null,
      firstPositionCalculatedAt: now,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    transaction.create(previewRef, record);
    transaction.set(onboardingRef, {
      status: "finalized",
      finalizedAt: now,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { created: true, preview: normalizePreviewRecord(record, now) };
  });
}

export async function markPreviewConverted(uid, { convertedAt = new Date() } = {}) {
  const ref = getAdminDb().collection("users").doc(uid).collection("access").doc("preview");
  const snapshot = await ref.get();
  if (!snapshot.exists) return false;
  if (snapshot.data()?.status === "converted") return false;
  await ref.set({
    status: "converted",
    convertedAt,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return true;
}

export function previewScheduleState(preview, { now = new Date(), balanceUpdatedAt = null } = {}) {
  const normalized = normalizePreviewRecord(preview, now);
  if (!normalized.used || !normalized.startedAt) return { type: null, normalized };
  if (normalized.status === "expired") return { type: "preview_expired", normalized };
  if (!normalized.active || preview.remindersEnabled === false) return { type: null, normalized };
  const elapsedHours = (now.getTime() - new Date(normalized.startedAt).getTime()) / 3600000;
  const day = Math.floor(elapsedHours / 24);
  if (day >= 6) return { type: "preview_ending", normalized };
  if (day >= 4) return { type: "preview_cost_check", normalized };
  if (day >= 2) {
    const balanceDate = asDate(balanceUpdatedAt);
    const staleHours = balanceDate ? (now.getTime() - balanceDate.getTime()) / 3600000 : Infinity;
    return { type: staleHours >= 36 ? "preview_balance_check" : null, normalized };
  }
  return { type: null, normalized };
}

export function firstIncompleteOnboardingStep({ balance, income, hasCost }) {
  if (!balance) return "balance";
  if (!income) return "payday";
  if (!hasCost) return "costs";
  return "position";
}
