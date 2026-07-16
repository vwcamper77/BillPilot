// Standalone Node helpers for the Playwright e2e suite. Runs outside Next.js's
// build tooling, so this can't use the "@/lib/..." path alias — it talks to
// firebase-admin directly and loads .env.local by hand.

import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const contents = fs.readFileSync(envPath, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvLocal();

export const ADMIN_TEST_EMAIL = "admin-test@cleartill.test";
export const NON_ADMIN_TEST_EMAIL = "nonadmin-test@cleartill.test";
const TEST_PASSWORD = "cleartill-e2e-test-password";

let adminApp = null;

function getFirebaseAdminApp() {
  if (adminApp) return adminApp;

  if (getApps().length) {
    adminApp = getApps()[0];
    return adminApp;
  }

  const projectId = String(process.env.FIREBASE_PROJECT_ID || "").trim();
  const clientEmail = String(
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL || "",
  ).trim();
  const privateKey = String(
    process.env.FIREBASE_ADMIN_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY || "",
  ).replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing Firebase Admin env vars — check .env.local before running e2e tests.");
  }

  adminApp = initializeApp({ projectId, credential: cert({ projectId, clientEmail, privateKey }) });
  return adminApp;
}

async function ensureTestUser(email) {
  const auth = getAuth(getFirebaseAdminApp());

  try {
    return await auth.getUserByEmail(email);
  } catch {
    return auth.createUser({ email, password: TEST_PASSWORD, emailVerified: true });
  }
}

export async function seedTestUsers() {
  const [adminUser, nonAdminUser] = await Promise.all([
    ensureTestUser(ADMIN_TEST_EMAIL),
    ensureTestUser(NON_ADMIN_TEST_EMAIL),
  ]);

  return { adminUser, nonAdminUser };
}

export async function grantTestAccess(uid, email = "") {
  const db = getFirestore(getFirebaseAdminApp());
  const accessUntil = new Date();
  accessUntil.setMonth(accessUntil.getMonth() + 1);

  await Promise.all([
    db.collection("users").doc(uid).set({
      uid,
      email: email || null,
      accessStatus: "active",
      accessPlan: "founding",
      accessSource: "e2e",
      accessUntil,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
    db.collection("customers").doc(uid).set({
      uid,
      email: email || null,
      paymentStatus: "paid",
      subscriptionStatus: "none",
      totalPaid: 500,
      currency: "gbp",
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
    // The unified entitlement resolver gives subscription state precedence.
    // Keep this shared browser fixture explicitly active so stale trial data
    // from another e2e flow cannot unexpectedly lock the dashboard.
    db.collection("users").doc(uid).collection("billing").doc("subscription").set({
      subscriptionStatus: "active",
      accessSource: "e2e",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]);
}

export async function seedDashboardState(uid, { currentBalance = null, payDay = null, payAmount = null } = {}) {
  const db = getFirestore(getFirebaseAdminApp());
  const writes = [];

  if (currentBalance !== null) {
    writes.push(
      db.collection("users").doc(uid).collection("settings").doc("balance").set({
        currentBalance,
        currency: "GBP",
        snapshotEntered: true,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
    );
  }

  if (payDay !== null) {
    writes.push(
      db.collection("users").doc(uid).collection("income").doc("main").set({
        type: "income",
        name: "Payday",
        amount: payAmount,
        currency: "GBP",
        frequency: "monthly",
        payDay,
        active: true,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
    );
  }

  await Promise.all(writes);
}

export async function seedUserSavings(uid, totalSetAside = 0) {
  const db = getFirestore(getFirebaseAdminApp());
  await db.collection("users").doc(uid).collection("settings").doc("savings").set({
    totalSetAside,
    currency: "GBP",
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function clearUserBills(uid) {
  const db = getFirestore(getFirebaseAdminApp());
  const snapshot = await db.collection("users").doc(uid).collection("bills").get();

  if (snapshot.empty) {
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

export async function seedUserBill(uid, { id = "e2e-bill", name = "E2E bill", amount = 1, dueDay = 5 } = {}) {
  const db = getFirestore(getFirebaseAdminApp());
  await db.collection("users").doc(uid).collection("bills").doc(id).set({
    type: "bill",
    name,
    amount,
    currency: "GBP",
    frequency: "monthly",
    dueDay,
    reminderOffsetDays: 1,
    active: true,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function seedUserIncomeEvent(uid, { id = "e2e-income-event", name = "Other income", amount = 100, expectedDate, frequency = "one_off", confidence = "confirmed" } = {}) {
  const db = getFirestore(getFirebaseAdminApp());
  await db.collection("users").doc(uid).collection("incomeEvents").doc(id).set({
    name,
    amount,
    expectedDate,
    frequency,
    confidence,
    status: "scheduled",
    active: true,
    currency: "GBP",
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function clearUserLargeCosts(uid) {
  const db = getFirestore(getFirebaseAdminApp());
  const snapshot = await db.collection("users").doc(uid).collection("largeCosts").get();

  if (snapshot.empty) {
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

export async function seedUserLargeCost(uid, {
  id = "e2e-large-cost",
  name = "Planned cost",
  amount = 100,
  dueDate,
  fundingStatus = "current_account",
  currentBalanceContribution = amount,
  savingsContribution = 0,
} = {}) {
  const db = getFirestore(getFirebaseAdminApp());
  await db.collection("users").doc(uid).collection("largeCosts").doc(id).set({
    type: "large_cost",
    name,
    amount,
    amountAlreadySaved: savingsContribution,
    currentBalanceContribution,
    savingsContribution,
    currency: "GBP",
    dueDate,
    frequency: "one_off",
    category: "other",
    fundingStatus,
    active: true,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function clearUserIncomeEvents(uid) {
  const db = getFirestore(getFirebaseAdminApp());
  const snapshot = await db.collection("users").doc(uid).collection("incomeEvents").get();
  if (snapshot.empty) return;
  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

export async function clearUserPrimaryIncome(uid) {
  const db = getFirestore(getFirebaseAdminApp());
  await db.collection("users").doc(uid).collection("income").doc("main").delete();
}

export async function mintCustomToken(uid) {
  const auth = getAuth(getFirebaseAdminApp());
  return auth.createCustomToken(uid);
}

/**
 * Mints a custom token for the given uid and exchanges it for a real ID
 * token via the Identity Toolkit REST API — the standard way to get a
 * usable ID token from a server-side test without driving a real OAuth flow.
 */
export async function getTestIdToken(uid) {
  const customToken = await mintCustomToken(uid);

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error("Missing NEXT_PUBLIC_FIREBASE_API_KEY — check .env.local before running e2e tests.");
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );

  const payload = await response.json();

  if (!response.ok || !payload.idToken) {
    throw new Error(`Could not exchange custom token for an ID token: ${JSON.stringify(payload)}`);
  }

  return payload.idToken;
}

export const SAMPLE_CUSTOMER_UID = "e2e-sample-customer";

/**
 * Seeds one customers/{uid} + analyticsEvents doc so the customer table and
 * detail-drawer scenarios have something real to render, independent of
 * whatever real signups exist in the dev Firestore project.
 */
export async function seedSampleCustomer() {
  const db = getFirestore(getFirebaseAdminApp());

  await db.collection("customers").doc(SAMPLE_CUSTOMER_UID).set({
    uid: SAMPLE_CUSTOMER_UID,
    name: "E2E Sample Customer",
    email: "e2e-sample-customer@cleartill.test",
    createdAt: FieldValue.serverTimestamp(),
    lastActiveAt: FieldValue.serverTimestamp(),
    attribution: {
      utm_source: "playwright",
      utm_medium: "e2e",
      utm_campaign: "e2e_fixture",
      anonymousSessionId: "e2e-sample-session",
    },
    stripeCustomerId: null,
    paymentStatus: "none",
    subscriptionStatus: "none",
    totalPaid: 0,
    currency: "gbp",
    billsCount: 1,
    onboardingStatus: "bills_added",
    dropOffStage: "bill_added",
    firstActionAfterSignup: "onboarding_started",
  }, { merge: true });

  // Deterministic id so repeated local test runs don't pile up duplicate
  // timeline entries for the same fixture customer.
  await db.collection("analyticsEvents").doc("e2e-sample-account-created").set({
    eventName: "account_created",
    uid: SAMPLE_CUSTOMER_UID,
    anonymousSessionId: "e2e-sample-session",
    pathname: "/dashboard",
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}
