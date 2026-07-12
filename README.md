# Billie

Billie is an AI-powered bill heads-up app for `billie.money`.

The MVP loop is:

```text
chat -> bill saved -> dashboard updated -> reminder created
```

It is intentionally simple: no Open Banking, no bank balance tracking, no debt management, no SMS, no categories, and no subscription analysis.

## Folder Structure

```text
app/
  page.jsx
  layout.jsx
  globals.css
  dashboard/
    page.jsx
  api/
    parse/
      route.js
    reminders/
      route.js

lib/
  firebase.js
  firebaseAdmin.js
  billMath.js

firestore.rules
vercel.json
.env.example
README.md
package.json
jsconfig.json
```

## Setup

Install dependencies:

```bash
npm install
```

Create `.env.local` from `.env.example` and fill in the Firebase, OpenAI, and cron values.

Firebase Auth should have anonymous sign-in enabled for this v1 build.

## Local Development

```bash
npm run dev
```

Open `http://localhost:3000`.

To test the cron route locally:

```bash
curl -H "Authorization: Bearer your-cron-secret" http://localhost:3000/api/reminders
```

## Deploying To Vercel

1. Push the project to GitHub.
2. Import the repository in Vercel.
3. Add all environment variables from `.env.example`.
4. Deploy.
5. Confirm the Vercel Cron entry is active for `/api/reminders`.

The Vercel Cron job runs daily at `07:00` and creates in-app reminder records only.

## Subscription trial foundation

The recurring subscription path is opt-in and leaves the existing £5 founding-member checkout in place.

- `SUBSCRIPTION_TRIAL_ENABLED=true` enables `/billing/subscribe`, recurring Checkout, subscription webhook handling and Customer Portal sessions.
- With the flag unset or false, the legacy checkout remains the active rollback path.
- `STRIPE_MONTHLY_PRICE_ID` must be a recurring £1.99 GBP monthly Price. Use different IDs in Stripe test and live mode.
- Checkout uses subscription mode, always collects a payment method, and applies a server-controlled seven-day trial. The Stripe Price itself should not have a trial configured.
- Do not treat the Checkout success URL as access evidence. Verified webhook state is authoritative.

Configure the existing Stripe webhook endpoint for:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
```

In Stripe Customer Portal settings, allow payment-method updates, invoice viewing/downloads and cancellation at period end. Configure Stripe Billing emails and failed-payment retries separately in test mode, then repeat deliberately in live mode.

### Rollout

1. Create the recurring Price and portal configuration in Stripe test mode.
2. Set the test Price ID and enable the flag only in a test deployment.
3. Complete the Test Clock plan below and verify Firestore entitlement records.
4. Create a separate live Price, configure the live portal/webhook/email settings, and set the live environment variables.
5. Roll back immediately by setting `SUBSCRIPTION_TRIAL_ENABLED=false`; do not remove the legacy `STRIPE_PRICE_ID` yet.

### Stripe Test Clock plan

1. Start Checkout and verify it shows £0 today, a card requirement, £1.99 monthly, and the exact trial end date.
2. Complete Checkout and verify `trialing` access arrives only after the signed webhook.
3. Advance to roughly 48 hours before trial end. Trial-ending email automation belongs to the later retention phase; for now verify Stripe's configured reminder behaviour.
4. Advance beyond day seven and verify one £1.99 invoice, `invoice.paid`, active access, and one recorded first payment.
5. Repeat with a failing test payment method; verify `past_due` keeps a recovery window and the portal permits a card update.
6. Let recovery end in `unpaid` or cancellation and verify premium access is removed while user data remains.
7. Cancel during trial and verify no first payment. Cancel after payment and verify access lasts until Stripe reports the period ended.
8. Open “Manage subscription” as the owner; verify another account cannot open that customer's portal.
9. Resend identical webhook events and verify event IDs prevent duplicate payment totals or state changes.
