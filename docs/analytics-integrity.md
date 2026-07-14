# Analytics and conversion integrity

## Trust boundary

Commercial conversion data is trustworthy only from the deployed value of `ANALYTICS_TRUST_VERSION` onward. Set it to an immutable release id or UTC deployment timestamp. It is written to every verified commercial outcome; it does not alter or delete historic GA4 data.

The Stripe webhook is the sole fulfilment and revenue authority. Success URLs only read Firestore records already written by a verified webhook. A Checkout Session id, redirect, page render, refresh, subscription creation, checkout completion, or £0 invoice is not revenue.

- One-off founding payment: complete, paid, positive GBP Checkout Session; transaction id is PaymentIntent id when present, otherwise Checkout Session id.
- Trial: `trial_started` / Meta `StartTrial` only for a webhook-verified `trialing` subscription.
- Revenue: `invoice.paid`, positive `amount_paid`, GBP; Stripe invoice id is the idempotency and analytics transaction id.
- The first positive invoice is `first_invoice_paid`; later positive invoices are `renewal_invoice_paid`.
- `commercialOutcomes` records make retries idempotent. Internal outcomes remain marked and excluded.

## Internal browser mode

Configure server-only `INTERNAL_ANALYTICS_UIDS`, a random 32+ character `INTERNAL_ANALYTICS_COOKIE_SECRET`, and `INTERNAL_ANALYTICS_COOKIE_VERSION`. Sign in with an allowed Firebase account, open Account, and select **Enable internal testing**. Repeat once on every browser/device. The signed Secure, HttpOnly, SameSite=Lax cookie contains a random browser id, expiry, and revocation version—not an email or UID—and expires after 30 days. Increase `INTERNAL_ANALYTICS_COOKIE_VERSION` to revoke all browsers.

Internal mode suppresses GA4/GTM, Meta Pixel, Meta CAPI, application funnel writes, and commercial dashboard inclusion. UTM values never override suppression. Checkout writes `internal_test=1` into safe Stripe metadata so later webhooks do not depend on the browser cookie. No financial data or email is stored in Stripe attribution metadata.

## GA4 manual configuration

1. In GA4, register/use the event parameter `traffic_type`.
2. Create an Internal Traffic data filter for `traffic_type = internal`.
3. Set it to **Testing** first.
4. Verify the events before changing the filter to **Active**.
5. Activation affects future data only; it does not repair historic data.

Normal internal activity is suppressed rather than sent. For a deliberate diagnostic, enable internal mode and select **Send diagnostic test events** in Account. It sends `internal_debug_test` with `debug_mode`, `traffic_type: internal`, and `test_event: true`, so it can be inspected in GA4 DebugView without looking like a purchase or commercial funnel outcome.

## Meta manual configuration

Set `META_PIXEL_ID`/`NEXT_PUBLIC_META_PIXEL_ID` and `META_CONVERSIONS_API_TOKEN` if CAPI is used. Set a temporary `META_TEST_EVENT_CODE` from Events Manager before selecting **Send diagnostic test events**. The diagnostic is named `InternalDebug`; it is not `Purchase`, `StartTrial`, or `Lead`.

Meta cannot reliably exclude a person who changes networks/IPs. ClearTill therefore suppresses Pixel and CAPI at the site. Use Meta advert preview/link-testing tools rather than repeatedly clicking a live advert. A live advert click may still incur spend and be counted by Meta; website suppression can prevent downstream conversions but cannot undo that click.

Browser/server events must share the same `event_id` if both are intentionally enabled. Current commerce conversions are server-only, avoiding a second browser event; Stripe invoice/session ids provide stable event ids.

## Attribution

The browser keeps separate 90-day first-touch and last-touch records. First touch is never overwritten; last touch changes only when a later campaign signal is present. Values are validated and length-limited. Captured fields are UTMs, `fbclid`, `_fbc`, `_fbp`, landing path, referrer, anonymous id, and timestamps. Checkout persists the complete safe attribution in the server-side checkout intent; Stripe receives only bounded, non-financial attribution fields/identifiers. Verified outcomes copy attribution for GA4/Meta and dashboard use.

UTMs describe attribution, not authenticity. Visitors without UTMs remain external unless authorised internal mode is active; visitors with UTMs remain suppressed when it is active. Existing application behavior has no consent manager, so this change preserves the existing consent posture rather than introducing a new tracking category.

## Funnel definitions

The commercial stages are `ad_landing_view`, `try_now_clicked`, `onboarding_started`, `first_clear_result_viewed`, `trial_offer_viewed`, `trial_checkout_started`, `trial_started`, `trial_cancelled`, `first_invoice_paid`, `renewal_invoice_paid`, and `invoice_payment_failed`. A paying customer has at least one positive verified payment. Stripe Customer creation, abandoned Checkout, failed Checkout, trials, and £0 invoices do not qualify.

Never add balances, bills, payday amounts, emails, spoken bill text, or other sensitive financial fields to analytics, attribution, or Stripe metadata.
