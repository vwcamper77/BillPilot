# Revenue integrity audit runbook

## Authoritative access decision

`lib/entitlementResolver.server.js` is the server-side source of truth for access. It reads, in parallel:

- `users/{uid}` for historical/manual access and server-configured bypasses;
- `users/{uid}/billing/subscription` for Stripe subscription state;
- `users/{uid}/access/entitlement` for the subscription entitlement projection;
- `pendingEntitlements` records claimed by the UID for founding-member access;
- `users/{uid}/settings/billing` for legacy paid access; and
- `customers/{uid}` for Stripe identifiers and the admin read model.

Clients may render the normalized result, but a client flag is never sufficient to grant access or create a checkout. Checkout routes call the same resolver and refuse duplicate checkout for active or pending payment states.

## Stripe event processing

`app/api/stripe/webhook/route.js` verifies the Stripe signature against the raw request text before processing. `stripeEvents/{eventId}` records `processing`, `succeeded`, or `failed`; a succeeded event is not processed twice, while failed/stale processing attempts can be retried.

Firebase UID metadata is authoritative. New checkout sessions store it on the Checkout Session and subscription, and webhook handling mirrors it to the Stripe Customer. Email-to-Firebase lookup is only a recovery fallback for legacy Stripe objects and produces reconciliation warnings when it cannot establish ownership.

Founding-member fulfilment additionally requires the configured `STRIPE_PRICE_ID`, exactly one unit of that Price, Checkout mode `payment`, a completed and paid Session, and an exact £5 GBP total. Plan metadata alone is never sufficient, and zero-value promotions do not enter the paid founding-member fulfilment path.

The success URL is read-only: it can display a webhook-created record but cannot create an entitlement, customer, purchase outcome, or email.

## Email triggers

| Email type | Trigger | Durable record |
| --- | --- | --- |
| `founding_member_access` | Verified, paid `checkout.session.completed` (or approved CLEAR100 QA checkout) creates a pending entitlement | `pendingEntitlements/{sessionId}.emailOutbox` |
| `trial_access` | Verified subscription Checkout completion creates a pending trial claim | `pendingTrialClaims/{checkoutIntentId}.emailOutbox` |
| `trial_start` | Scheduler fallback for trialing subscriptions that have no successfully sent `trial_access` email | `emailDeliveries/{uid}:trial_start:{subscriptionId}` |
| `trial_ending` | Scheduler sees a trial ending within 48 hours | `emailDeliveries/{uid}:trial_ending:{subscriptionId}:ending` |
| `payment_failed` | Scheduler sees the webhook-synchronised latest invoice status as failed | `emailDeliveries/{uid}:payment_failed:{date}:payment_failed` |

The founding and trial-access emails are sent only after signed Stripe confirmation. Provider message IDs, send timestamps, type/status, attempts, and deterministic idempotency keys are persisted. A £0 trial invoice is not a purchase and does not emit a purchase event or “payment received” email.

## Read-only production reconciliation

Run from an environment containing production Stripe/Firebase Admin credentials and, optionally, a Resend API key:

```bash
npm run reconcile:stripe -- --date=2026-07-13
```

The script searches both £5 Checkout Sessions and £5 Payment Intents, then reports Stripe identifiers/status, Firebase ownership, relevant Stripe events, application webhook processing records, entitlement/admin records, email outbox state, Resend delivery state when available, metadata gaps, mismatches, duplicates, and failed webhook processing. It rejects `--apply` and never writes or creates a charge.

Do not backfill from an email address alone. After reviewing the report, a targeted backfill must use the verified Checkout Session/Payment Intent and authenticated UID, preserve existing access with the later expiry, merge revenue additively exactly once, retain the Stripe event and email audit fields, and record the operator/reason. Re-run the read-only report after the change.
