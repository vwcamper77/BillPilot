/**
 * Safe logging helper for ClearTill.
 *
 * Wraps console logging so that money-like and free-text fields are stripped
 * from metadata before anything is written. Use this anywhere you want to log
 * context alongside an event without risking leaking user financial values,
 * CSV/AI text, uploaded content or raw document payloads.
 *
 * Example:
 *   safeWarn("CSV import failed", { reason: "parse_error" });
 *
 * This module is isomorphic (no Node-only imports) so it is safe to use from
 * both client and server code.
 */

// Substrings that mark a metadata key as sensitive. Any key whose lowercased
// name contains one of these is dropped entirely.
const SENSITIVE_KEY_PARTS = [
  "amount",
  "balance",
  "income",
  "salary",
  "bill",
  "cost",
  "saving",
  "note",
  "text",
  "raw",
  "csv",
  "upload",
  "content",
  "description",
  "payload",
];

function isSensitiveKey(key) {
  const lower = String(key).toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => lower.includes(part));
}

/**
 * Return a shallow copy of `metadata` with sensitive keys removed and only
 * safe primitive values kept. Nested objects/arrays are dropped because we
 * cannot guarantee they are free of sensitive content.
 */
export function sanitiseLogMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return undefined;
  }

  const safe = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (isSensitiveKey(key)) {
      continue;
    }

    if (
      typeof value === "number"
      || typeof value === "boolean"
      || value === null
    ) {
      safe[key] = value;
    } else if (typeof value === "string") {
      // Keep short, non-money-like labels only.
      const trimmed = value.trim().slice(0, 80);
      if (!/[£$€]|\d+\.\d{2}/.test(trimmed)) {
        safe[key] = trimmed;
      }
    }
    // Objects, arrays and functions are intentionally dropped.
  }

  return Object.keys(safe).length ? safe : undefined;
}

function emit(method, message, metadata) {
  const safe = sanitiseLogMetadata(metadata);

  if (safe) {
    console[method](message, safe);
  } else {
    console[method](message);
  }
}

export function safeInfo(message, metadata) {
  emit("log", message, metadata);
}

export function safeWarn(message, metadata) {
  emit("warn", message, metadata);
}

export function safeError(message, metadata) {
  emit("error", message, metadata);
}
