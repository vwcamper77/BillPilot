/**
 * Fails closed: unset, missing, or any value other than the exact string
 * "false" keeps the legacy authenticated checkout active. The new
 * no-auth-first flow is opt-in only. Server-only (reads process.env) —
 * call from Server Components / API routes, never from a "use client" file.
 */
export function isPublicCheckoutEnabled() {
  return process.env.CHECKOUT_AUTH_REQUIRED === "false";
}
