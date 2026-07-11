/**
 * Non-destructive canonical-entitlement backfill. Dry-run is the default.
 * Run: node scripts/backfill-entitlements.mjs
 * Apply only after reviewing the JSON report: node scripts/backfill-entitlements.mjs --apply
 */
import fs from "node:fs";
import path from "node:path";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !(match[1].trim() in process.env)) process.env[match[1].trim()] = match[2].trim();
  }
}

const apply = process.argv.includes("--apply");
if (!getApps().length) {
  initializeApp({ credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: String(process.env.FIREBASE_PRIVATE_KEY || process.env.FIREBASE_ADMIN_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  }) });
}

const db = getFirestore();
const auth = getAuth();
const report = { mode: apply ? "apply" : "dry-run", eligible: [], skipped: [], conflicts: [] };
const maskSession = (value) => value ? `${value.slice(0, 8)}...${value.slice(-4)}` : null;
// Read the small legacy settings group and filter locally so the dry run does
// not require deploying a one-off Firestore collection-group index.
const billingDocs = await db.collectionGroup("settings").get();

for (const billingDoc of billingDocs.docs) {
  if (billingDoc.id !== "billing") continue;
  const uid = billingDoc.ref.parent.parent?.id;
  const billing = billingDoc.data();
  if (billing.plan !== "founding_3_months" && !billing.accessExpiresAt && !billing.accessUntil) continue;
  if (!uid) continue;
  const sessionId = String(billing.stripeCheckoutSessionId || `legacy_${uid}`).trim();
  const target = db.collection("pendingEntitlements").doc(sessionId);
  if ((await target.get()).exists) {
    report.skipped.push({ uid, sessionId: maskSession(sessionId), reason: "canonical_entitlement_exists" });
    continue;
  }

  let user;
  try { user = await auth.getUser(uid); } catch { user = null; }
  if (!user?.email || !user.emailVerified) {
    report.conflicts.push({ uid, sessionId: maskSession(sessionId), reason: "firebase_email_missing_or_unverified" });
    continue;
  }

  const normalizedEmail = user.email.trim().toLowerCase();
  const stripeEmail = String(billing.checkoutEmail || billing.email || normalizedEmail).trim().toLowerCase();
  if (stripeEmail !== normalizedEmail) {
    report.conflicts.push({ uid, sessionId: maskSession(sessionId), reason: "email_mismatch" });
    continue;
  }

  report.eligible.push({ uid, sessionId: maskSession(sessionId), source: "legacy_billing", email: `${normalizedEmail.slice(0, 1)}***@${normalizedEmail.split("@")[1]}` });
  if (apply) {
    await target.set({
      uid,
      status: "active",
      planKey: "founding_member",
      planName: "Founding Member",
      accessSource: billing.coupon ? "stripe_promotion" : (billing.accessSource || "legacy"),
      paymentType: billing.coupon || Number(billing.amountPaid) === 0 ? "promotional" : "paid",
      amountPaidMinor: Number(billing.amountPaid) || 0,
      currency: String(billing.currency || "gbp").toLowerCase(),
      accessStartsAt: billing.accessStartedAt || null,
      accessExpiresAt: billing.accessExpiresAt || billing.accessUntil || null,
      accessDurationDays: 90,
      stripeCustomerId: billing.stripeCustomerId || null,
      stripeCheckoutSessionId: billing.stripeCheckoutSessionId || null,
      stripeSubscriptionId: billing.stripeSubscriptionId || null,
      promotionLabel: billing.coupon || null,
      checkoutEmail: stripeEmail,
      claimedEmail: normalizedEmail,
      claimedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
