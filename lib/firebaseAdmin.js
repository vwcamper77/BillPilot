import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

let hasLoggedAdminEnv = false;
let hasLoggedFirestoreProject = false;

function getAdminEnv() {
  return {
    projectId: String(process.env.FIREBASE_PROJECT_ID || "").trim(),
    clientEmail: String(
      process.env.FIREBASE_ADMIN_CLIENT_EMAIL
        || process.env.FIREBASE_CLIENT_EMAIL
        || "",
    ).trim(),
    privateKey: (
      process.env.FIREBASE_ADMIN_PRIVATE_KEY
      || process.env.FIREBASE_PRIVATE_KEY
      || ""
    ).replace(/\\n/g, "\n"),
    publicProjectId: String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim(),
  };
}

function logAdminDiagnostics(env) {
  if (hasLoggedAdminEnv) {
    return;
  }

  hasLoggedAdminEnv = true;

  console.info(`[firebase-admin] FIREBASE_PROJECT_ID ${env.projectId ? "present" : "missing"}`);
  console.info(`[firebase-admin] FIREBASE_ADMIN_CLIENT_EMAIL ${process.env.FIREBASE_ADMIN_CLIENT_EMAIL ? "present" : "missing"}`);
  console.info(`[firebase-admin] FIREBASE_ADMIN_PRIVATE_KEY ${process.env.FIREBASE_ADMIN_PRIVATE_KEY ? "present" : "missing"}`);
  console.info(`[firebase-admin] FIREBASE_CLIENT_EMAIL ${process.env.FIREBASE_CLIENT_EMAIL ? "present" : "missing"}`);
  console.info(`[firebase-admin] FIREBASE_PRIVATE_KEY ${process.env.FIREBASE_PRIVATE_KEY ? "present" : "missing"}`);

  if (env.projectId && env.publicProjectId && env.projectId !== env.publicProjectId) {
    console.warn(
      `[firebase-admin] Project mismatch: FIREBASE_PROJECT_ID=${env.projectId} but NEXT_PUBLIC_FIREBASE_PROJECT_ID=${env.publicProjectId}.`,
    );
  }
}

function getFirebaseAdminApp() {
  const env = getAdminEnv();
  logAdminDiagnostics(env);

  if (getApps().length) {
    return getApps()[0];
  }

  if (!env.projectId || !env.clientEmail || !env.privateKey) {
    throw new Error("Missing Firebase Admin environment variables.");
  }

  const app = initializeApp({
    projectId: env.projectId,
    credential: cert({
      projectId: env.projectId,
      clientEmail: env.clientEmail,
      privateKey: env.privateKey,
    }),
  });

  console.info(`[firebase-admin] Admin app initialised for project ${env.projectId}`);

  return app;
}

export function getAdminDb() {
  const app = getFirebaseAdminApp();
  const db = getFirestore(app);

  if (!hasLoggedFirestoreProject) {
    hasLoggedFirestoreProject = true;
    console.info(`[firebase-admin] Firestore project id ${app.options.projectId || getFirebaseProjectId()}`);
  }

  return db;
}

export function getAdminAuth() {
  return getAuth(getFirebaseAdminApp());
}

export function getFirebaseProjectId() {
  return getAdminEnv().projectId;
}

export function isFirestoreNotFoundError(error) {
  const code = error?.code;
  const message = String(error?.message || "");

  return Number(code) === 5
    || String(code || "").toLowerCase() === "not-found"
    || String(code || "").toLowerCase() === "not_found"
    || message.includes("5 NOT_FOUND");
}

export function describeFirestoreAdminError(error) {
  const projectId = getFirebaseProjectId() || "(missing project id)";

  if (isFirestoreNotFoundError(error)) {
    return `Firestore database not found for project ${projectId}. Check that Firestore is created/enabled in Firebase Console and that FIREBASE_PROJECT_ID is correct.`;
  }

  return error?.message || "Firestore request failed.";
}

export { FieldValue };
