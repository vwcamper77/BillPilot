import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb, FieldValue } from "@/lib/firebaseAdmin";
import { logSecurityEvent, SECURITY_ACTIONS } from "@/lib/security/auditLog";
import { encryptObjectFields, isEncryptionConfigured } from "@/lib/security/encryption";
import { SECURE_IMPORT_SENSITIVE_FIELDS } from "@/lib/security/sensitiveFields";

export const runtime = "nodejs";

const VALID_ACTIONS = new Set(Object.values(SECURITY_ACTIONS));
const SECURE_IMPORTS_COLLECTION = "secureImports";

/**
 * Endpoint for client-initiated security operations:
 *   - log_event   : record a sanitised audit event (no sensitive values).
 *   - store_import : encrypt and archive import provenance (AI / CSV / uploaded
 *                    extracted text) into an at-rest-encrypted collection the
 *                    client never reads back. This is where real server-side
 *                    field encryption is applied before a Firestore write.
 */
export async function POST(request) {
  try {
    const decodedToken = await verifyRequest(request);
    const userId = decodedToken.uid;
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "").trim();

    if (action === "store_import") {
      return await handleStoreImport(userId, body);
    }

    if (action === "log_event") {
      return await handleLogEvent(userId, body);
    }

    return NextResponse.json(
      { ok: false, error: "Unsupported security action." },
      { status: 400 },
    );
  } catch (error) {
    if (
      error?.code === "auth/missing-id-token"
      || error?.code === "auth/invalid-id-token"
      || error?.code === "auth/id-token-expired"
    ) {
      return NextResponse.json(
        { ok: false, error: "Please sign in again." },
        { status: 401 },
      );
    }

    console.error("[security] error", error);

    return NextResponse.json(
      { ok: false, error: "Could not complete that security action." },
      { status: 500 },
    );
  }
}

async function handleLogEvent(userId, body) {
  const eventAction = String(body?.event || "").trim();

  if (!VALID_ACTIONS.has(eventAction)) {
    return NextResponse.json(
      { ok: false, error: "Unknown audit event." },
      { status: 400 },
    );
  }

  await logSecurityEvent({
    userId,
    action: eventAction,
    metadata: body?.metadata,
  });

  return NextResponse.json({ ok: true });
}

async function handleStoreImport(userId, body) {
  const source = String(body?.source || "import").slice(0, 32);
  // Free-text / provenance fields the client extracted. Only sensitive keys
  // are kept; everything else is ignored.
  const record = {};

  for (const field of SECURE_IMPORT_SENSITIVE_FIELDS) {
    if (body?.[field] !== undefined && body?.[field] !== null && body?.[field] !== "") {
      record[field] = body[field];
    }
  }

  if (!Object.keys(record).length) {
    // Nothing sensitive to archive — still log the import event.
    await logSecurityEvent({
      userId,
      action: source === "csv"
        ? SECURITY_ACTIONS.CSV_UPLOADED
        : SECURITY_ACTIONS.AI_IMPORT_USED,
      metadata: { source },
    });
    return NextResponse.json({ ok: true, archived: false });
  }

  const encrypted = encryptObjectFields(record, userId, SECURE_IMPORT_SENSITIVE_FIELDS);

  const db = getAdminDb();
  await db
    .collection("users")
    .doc(userId)
    .collection(SECURE_IMPORTS_COLLECTION)
    .add({
      ...encrypted,
      source,
      encrypted: isEncryptionConfigured(),
      createdAt: FieldValue.serverTimestamp(),
    });

  await logSecurityEvent({
    userId,
    action: source === "csv"
      ? SECURITY_ACTIONS.CSV_UPLOADED
      : SECURITY_ACTIONS.AI_IMPORT_USED,
    metadata: { source, archived: true },
  });

  return NextResponse.json({ ok: true, archived: true });
}

async function verifyRequest(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match?.[1]) {
    const error = new Error("Unauthorized");
    error.code = "auth/missing-id-token";
    throw error;
  }

  return getAdminAuth().verifyIdToken(match[1]);
}
