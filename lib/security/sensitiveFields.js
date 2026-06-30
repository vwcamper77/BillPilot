/**
 * Sensitive field mapping for ClearTill.
 *
 * Lists which fields on each record type hold sensitive financial information
 * and should be passed to encryptObjectFields / decryptObjectFields when a
 * record is persisted or read back on the server.
 *
 * Design rule: keep anything needed for querying, scheduling, or realtime
 * client calculation OUT of these lists — IDs, dates (dueDay, nextDueDate,
 * reminderDate, payDay), userId, currency, category, source and createdAt all
 * stay in plaintext. Only free-text / provenance blobs that are processed and
 * stored server-side are encrypted, so the client realtime dashboard keeps
 * working with plaintext numbers.
 *
 * Amount/balance fields are listed here so the helpers are ready if/when those
 * collections move behind a server-side data layer. Today they are written by
 * the client and therefore remain plaintext — see docs/security.md.
 */

// settings/balance — current available money snapshot.
export const BALANCE_SENSITIVE_FIELDS = ["currentBalance"];

// income/main — payday amount.
export const INCOME_SENSITIVE_FIELDS = ["amount"];

// bills/{billId} — bill amount plus any free-text the user/parser added.
export const BILL_SENSITIVE_FIELDS = ["amount", "name", "note", "notes"];

// largeCosts/{costId} — planned large cost values.
export const LARGE_COST_SENSITIVE_FIELDS = ["amount", "amountAlreadySaved", "note"];

// settings/savings — general savings pot.
export const SAVINGS_SENSITIVE_FIELDS = ["currentBalance"];

/**
 * secureImports/{id} — encrypted-at-rest archive of import provenance.
 *
 * This collection is written ONLY by the server and is never read by the
 * client realtime listeners, so these fields are genuinely encrypted at rest:
 *   - rawText / extractedText: raw OCR / CSV / AI parsed text
 *   - notes: free-text the user attached to an upload
 *   - payload: structured parsed result kept for audit / re-import
 */
export const SECURE_IMPORT_SENSITIVE_FIELDS = [
  "rawText",
  "extractedText",
  "csvText",
  "notes",
  "payload",
];

/**
 * Fields that must always stay unencrypted because they are used for querying,
 * scheduling or realtime calculation. Documented here for clarity / review.
 */
export const NEVER_ENCRYPT_FIELDS = [
  "id",
  "userId",
  "uid",
  "currency",
  "category",
  "source",
  "frequency",
  "dueDay",
  "payDay",
  "nextDueDate",
  "reminderDate",
  "reminderOffsetDays",
  "createdAt",
  "updatedAt",
];

export const SENSITIVE_FIELDS_BY_TYPE = {
  balance: BALANCE_SENSITIVE_FIELDS,
  income: INCOME_SENSITIVE_FIELDS,
  bill: BILL_SENSITIVE_FIELDS,
  largeCost: LARGE_COST_SENSITIVE_FIELDS,
  savings: SAVINGS_SENSITIVE_FIELDS,
  secureImport: SECURE_IMPORT_SENSITIVE_FIELDS,
};
