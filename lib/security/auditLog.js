/**
 * Security audit logging for ClearTill.
 *
 * Writes a tamper-evident-ish trail of security-relevant actions to a Firestore
 * collection (`securityAuditEvents`) using the Admin SDK. This runs server-side
 * only.
 *
 * Privacy rule: NEVER log sensitive financial values (balances, amounts, bill
 * names, statement text). Only log the action, the user it relates to, and
 * coarse, non-sensitive metadata (counts, sources, booleans). `logSecurityEvent`
 * actively strips anything that looks like a money value as a backstop.
 */

import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";

const AUDIT_COLLECTION = "securityAuditEvents";

// Canonical action names. Callers should use these constants where possible.
export const SECURITY_ACTIONS = {
  BILL_CREATED: "bill_created",
  BILL_UPDATED: "bill_updated",
  BILL_DELETED: "bill_deleted",
  BALANCE_UPDATED: "balance_updated",
  CSV_UPLOADED: "csv_uploaded",
  AI_IMPORT_USED: "ai_import_used",
  DATA_EXPORT_REQUESTED: "data_export_requested",
  DATA_RESET_REQUESTED: "data_reset_requested",
  ACCOUNT_DELETE_REQUESTED: "account_delete_requested",
};

// Keys that must never appear in audit metadata, even if a caller passes them.
const FORBIDDEN_METADATA_KEYS = new Set([
  "amount",
  "amounts",
  "balance",
  "currentBalance",
  "currency",
  "name",
  "billName",
  "note",
  "notes",
  "rawText",
  "extractedText",
  "csvText",
  "payload",
  "value",
]);

/**
 * Keep only safe, primitive metadata: numbers, booleans, and short strings
 * that are not money-like. Drops forbidden keys and anything nested/large.
 */
function sanitiseMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }

  const safe = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.has(key)) {
      continue;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      safe[key] = value;
    } else if (typeof value === "boolean") {
      safe[key] = value;
    } else if (typeof value === "string") {
      // Allow short, non-sensitive labels only (e.g. source: "csv").
      const trimmed = value.trim().slice(0, 64);
      // Skip strings that look like currency amounts.
      if (!/[£$€]|\d+\.\d{2}/.test(trimmed)) {
        safe[key] = trimmed;
      }
    }
    // Objects, arrays, functions etc. are intentionally dropped.
  }

  return safe;
}

/**
 * Record a security event.
 *
 * @param {Object} event
 * @param {string} event.userId  - the user the action relates to (required)
 * @param {string} event.action  - one of SECURITY_ACTIONS (required)
 * @param {Object} [event.metadata] - non-sensitive context (counts, sources…)
 *
 * Never throws — audit logging must not break the user-facing action it
 * accompanies. Failures are logged to the server console only.
 */
export async function logSecurityEvent({ userId, action, metadata } = {}) {
  try {
    if (!userId || !action) {
      return { ok: false, error: "userId and action are required" };
    }

    const db = getAdminDb();
    const entry = {
      userId: String(userId),
      action: String(action),
      metadata: sanitiseMetadata(metadata),
      createdAt: FieldValue.serverTimestamp(),
    };

    await db.collection(AUDIT_COLLECTION).add(entry);

    return { ok: true };
  } catch (error) {
    console.error("[security/auditLog] failed to record event", error?.message);
    return { ok: false, error: error?.message };
  }
}

export { AUDIT_COLLECTION };
