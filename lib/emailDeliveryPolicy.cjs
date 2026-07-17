const EMAIL_MAX_ATTEMPTS = 5;
const EMAIL_CLAIM_LEASE_MS = 10 * 60 * 1000;

function millis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function decideEmailClaim(existing, nowMs, { maxAttempts = EMAIL_MAX_ATTEMPTS } = {}) {
  if (!existing) return { ok: true, attempts: 1, recovery: "new" };
  if (existing.status === "sent") return { ok: false, reason: "duplicate" };
  const attempts = Math.max(0, Number(existing.attempts) || 0);
  if (existing.status === "permanent_failure" || attempts >= maxAttempts) {
    return { ok: false, reason: "max_attempts" };
  }
  if (existing.status === "claimed" && millis(existing.leaseExpiresAt) > nowMs) {
    return { ok: false, reason: "in_progress" };
  }
  return {
    ok: true,
    attempts: attempts + 1,
    recovery: existing.status === "claimed" ? "stale_claim" : "retry",
  };
}

function failureStatusForAttempt(attempts, maxAttempts = EMAIL_MAX_ATTEMPTS) {
  return Number(attempts) >= maxAttempts ? "permanent_failure" : "failed";
}

module.exports = {
  EMAIL_MAX_ATTEMPTS,
  EMAIL_CLAIM_LEASE_MS,
  decideEmailClaim,
  failureStatusForAttempt,
};
