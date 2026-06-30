/**
 * Application-level (field-level) encryption for sensitive ClearTill financial data.
 *
 * This module provides AES-256-GCM authenticated encryption for individual
 * fields *before* they are written to storage, and decryption when they are
 * read back. It is an application-layer control that sits on top of whatever
 * encryption-at-rest the database already provides — it means a leaked database
 * dump does not expose plaintext financial notes / imported statement text
 * without also holding the master key.
 *
 * IMPORTANT — server only:
 *   - The master key lives in `DATA_ENCRYPTION_MASTER_KEY`, a server-only env var.
 *   - This file uses Node's `crypto` module and must NEVER be imported into
 *     client ("use client") bundles. Keep it behind API routes / server code.
 *
 * Key handling:
 *   - A per-user key is derived from the master key + userId using HKDF-SHA256.
 *     This binds every ciphertext to a single user, so records cannot be moved
 *     between accounts and decrypted.
 *   - The userId is *also* used as Additional Authenticated Data (AAD) so the
 *     GCM auth tag fails if a record is replayed under a different user.
 *
 * Stored payload shape (see PAYLOAD_VERSION):
 *   { __enc: true, v: 1, iv: <base64>, tag: <base64>, ct: <base64> }
 *
 *   The `__enc` marker lets read paths cheaply tell an encrypted payload apart
 *   from a legacy plaintext value, which is what makes backwards compatibility
 *   with pre-encryption records possible.
 */

import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256-bit key
const IV_LENGTH = 12; // 96-bit nonce, recommended for GCM
const PAYLOAD_VERSION = 1;
const HKDF_INFO = "cleartill-field-encryption-v1";
const ENC_MARKER = "__enc";

let cachedMasterKey;

/**
 * Resolve and cache the raw master key from the environment.
 * Accepts base64, hex, or a raw passphrase. Anything that is not exactly
 * 32 bytes after decoding is hashed down to a stable 32-byte key so the
 * module never silently runs with a weak/short key.
 */
function getMasterKey() {
  if (cachedMasterKey) {
    return cachedMasterKey;
  }

  const raw = process.env.DATA_ENCRYPTION_MASTER_KEY;

  if (!raw || !raw.trim()) {
    throw new Error(
      "DATA_ENCRYPTION_MASTER_KEY is not set. Field-level encryption is unavailable.",
    );
  }

  const trimmed = raw.trim();
  let keyBuffer = tryDecode(trimmed, "base64") || tryDecode(trimmed, "hex");

  if (!keyBuffer || keyBuffer.length !== KEY_LENGTH) {
    // Fall back to a deterministic 32-byte key derived from the supplied value.
    keyBuffer = crypto.createHash("sha256").update(trimmed, "utf8").digest();
  }

  cachedMasterKey = keyBuffer;
  return cachedMasterKey;
}

function tryDecode(value, encoding) {
  try {
    const buffer = Buffer.from(value, encoding);
    // Reject obviously wrong decodes (e.g. base64 of a passphrase) unless the
    // length is exactly right for a 256-bit key.
    return buffer.length === KEY_LENGTH ? buffer : null;
  } catch {
    return null;
  }
}

/**
 * Derive a stable per-user 32-byte key from the master key + userId.
 * HKDF gives us a clean way to namespace one master secret into many
 * user-scoped keys without storing anything extra.
 */
function deriveUserKey(userId) {
  const salt = Buffer.from(String(userId || "anonymous"), "utf8");
  const derived = crypto.hkdfSync(
    "sha256",
    getMasterKey(),
    salt,
    Buffer.from(HKDF_INFO, "utf8"),
    KEY_LENGTH,
  );

  // hkdfSync returns an ArrayBuffer; normalise to a Buffer.
  return Buffer.from(derived);
}

/**
 * True when `value` looks like an encrypted payload produced by this module.
 * Used by decrypt paths to leave legacy plaintext records untouched.
 */
export function isEncryptedPayload(value) {
  return Boolean(
    value
    && typeof value === "object"
    && value[ENC_MARKER] === true
    && typeof value.ct === "string"
    && typeof value.iv === "string"
    && typeof value.tag === "string",
  );
}

/**
 * Encrypt a single sensitive value bound to a user.
 *
 * Returns:
 *   - `null` / `undefined` unchanged (nothing to protect).
 *   - "" (empty string) unchanged — encrypting empty strings adds no value
 *     and complicates "is this set?" checks downstream.
 *   - otherwise a structured encrypted payload object.
 *
 * Non-string values are JSON-serialised first and a type hint is stored so
 * `decryptSensitiveValue` can restore numbers/objects/booleans exactly.
 */
export function encryptSensitiveValue(value, userId) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string" && value === "") {
    return value;
  }

  // Preserve the original type across the round-trip.
  let type;
  let plaintext;

  if (typeof value === "string") {
    type = "string";
    plaintext = value;
  } else {
    type = "json";
    plaintext = JSON.stringify(value);
  }

  const key = deriveUserKey(userId);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  // Bind the ciphertext to this user via Additional Authenticated Data.
  cipher.setAAD(Buffer.from(String(userId || "anonymous"), "utf8"));

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    [ENC_MARKER]: true,
    v: PAYLOAD_VERSION,
    t: type,
    iv: iv.toString("base64"),
    tag: authTag.toString("base64"),
    ct: ciphertext.toString("base64"),
  };
}

/**
 * Decrypt a payload produced by `encryptSensitiveValue`.
 *
 * Backwards compatibility: if `encryptedPayload` is not a recognised encrypted
 * payload it is returned as-is, so pre-encryption (plaintext) records keep
 * working. If decryption fails (wrong key / tampered / wrong user) the raw
 * payload is returned rather than throwing, so a single bad record never takes
 * down a read path. Callers that need the value as a number should coerce it.
 */
export function decryptSensitiveValue(encryptedPayload, userId) {
  if (encryptedPayload === null || encryptedPayload === undefined) {
    return encryptedPayload;
  }

  // Legacy plaintext value — leave it usable.
  if (!isEncryptedPayload(encryptedPayload)) {
    return encryptedPayload;
  }

  try {
    const key = deriveUserKey(userId);
    const iv = Buffer.from(encryptedPayload.iv, "base64");
    const authTag = Buffer.from(encryptedPayload.tag, "base64");
    const ciphertext = Buffer.from(encryptedPayload.ct, "base64");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from(String(userId || "anonymous"), "utf8"));
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");

    if (encryptedPayload.t === "json") {
      try {
        return JSON.parse(plaintext);
      } catch {
        return plaintext;
      }
    }

    return plaintext;
  } catch (error) {
    console.error("[security/encryption] decrypt failed", error?.message);
    return encryptedPayload;
  }
}

/**
 * Return a shallow copy of `object` with the named fields encrypted.
 * Fields that are absent, null, undefined or empty strings are left as-is.
 * IDs, dates, userId, category, createdAt etc. should NOT be passed in
 * `fieldNames` so they remain queryable — see lib/security/sensitiveFields.js.
 */
export function encryptObjectFields(object, userId, fieldNames) {
  if (!object || typeof object !== "object" || !Array.isArray(fieldNames)) {
    return object;
  }

  const result = { ...object };

  for (const field of fieldNames) {
    if (!(field in result)) {
      continue;
    }

    const value = result[field];

    if (value === null || value === undefined || value === "") {
      continue;
    }

    // Don't double-encrypt an already-encrypted field.
    if (isEncryptedPayload(value)) {
      continue;
    }

    result[field] = encryptSensitiveValue(value, userId);
  }

  return result;
}

/**
 * Return a shallow copy of `object` with the named fields decrypted.
 * Plaintext (legacy) fields pass through unchanged for backwards compatibility.
 */
export function decryptObjectFields(object, userId, fieldNames) {
  if (!object || typeof object !== "object" || !Array.isArray(fieldNames)) {
    return object;
  }

  const result = { ...object };

  for (const field of fieldNames) {
    if (!(field in result)) {
      continue;
    }

    result[field] = decryptSensitiveValue(result[field], userId);
  }

  return result;
}

/** True when a usable master key is configured (without throwing). */
export function isEncryptionConfigured() {
  try {
    getMasterKey();
    return true;
  } catch {
    return false;
  }
}
