# ClearTill billing security review

## Executive summary

The billing changes preserve Stripe signature verification, make the webhook the entitlement source of truth, require server-verified Firebase identity, and deny client writes to canonical billing records. No critical issue remains in the reviewed flow. The changes must not be merged until real paid, promotional, email/password, and Google claim journeys pass end to end.

## High severity

No open high-severity finding remains in the changed billing flow.

### SEC-001 - Fixed: client-writable billing authority

- Location: `firestore.rules:10-22`, `app/api/account/route.js:9`, `app/api/access/route.js:7`
- Evidence: canonical entitlements, Stripe event records, and `users/{uid}/settings/billing` now deny client writes.
- Impact: previously a customer could write the legacy billing document that `/account` read directly.
- Fix: `/account` and `/api/access` now use an authenticated Admin SDK resolver; client billing writes are denied.

### SEC-002 - Fixed: unrelated Stripe Checkout sessions could be fulfilled

- Location: `lib/entitlements.server.js:162`, `createPendingEntitlementFromCheckoutSession`
- Evidence: fulfilment now rejects sessions without the server-issued founding-member plan metadata.
- Impact: without an offer check, another completed Checkout Session in the same Stripe account could be interpreted as ClearTill access.
- Fix: require `founding_member` or the existing internal founding plan identifier.

## Medium severity

### SEC-003 - Deployment verification required: Firestore rules

- Location: `firestore.rules:10-22`
- Evidence: repository rules deny entitlement and billing mutations, but deployment state is not visible from the local repository.
- Impact: production remains exposed if the updated rules are not deployed.
- Fix: deploy the rules and verify an authenticated client cannot write its billing settings or canonical entitlement.

### SEC-004 - End-to-end identity paths not yet proven

- Location: `app/api/access/claim/route.js:50`, `app/api/stripe/webhook/route.js:21-40`
- Evidence: code requires `email_verified === true`, exact normalized email equality, and a single-use hashed token.
- Impact: provider-specific Firebase token behavior or production configuration could still block legitimate claims.
- Fix: complete the requested paid, promotional, email/password, and Google Playwright journeys before merge.

## Low severity

### SEC-005 - Collection name is historical

- Location: `pendingEntitlements/{checkoutSessionId}`
- Evidence: this collection now holds both pending and active canonical entitlements.
- Impact: the name can mislead future maintainers but does not weaken authorization.
- Fix: document it as canonical until a carefully staged migration can rename it without creating two sources of truth.
