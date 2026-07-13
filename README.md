# ClearTill

ClearTill is a payday-aware bill heads-up app focused on one question:
"Am I clear till payday?"

The MVP loop is:

```text
chat -> bill saved -> dashboard updated -> reminder created
```

It is intentionally simple: no Open Banking, no bank linking, no debt management, no SMS, and no hidden bank syncing.

## Folder Structure

```text
app/
  page.jsx
  layout.jsx
  globals.css
  dashboard/
    page.jsx
  billing/
    page.jsx
  api/
    analytics/
      route.js
    billing/
      status/route.js
    email/
      unsubscribe/route.js
    parse/
      route.js
    reminders/
      route.js
    scheduler/
      route.js
    stripe/
      checkout/route.js
      portal/route.js
      webhook/route.js

lib/
  analytics.js
  firebase.js
  firebaseAdmin.js
  billMath.js
  clientAnalytics.js
  email.js
  serverAuth.js
  billing/
    access.js
    config.js
    store.js
    stripe.js
    subscriptionSync.js

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

Create `.env.local` from `.env.example` and fill in the Firebase, OpenAI, cron, Stripe, and email values.

Firebase Auth should have anonymous sign-in enabled so visitors can see their first result before starting the trial.

Stripe setup for the subscription trial:

1. Create a recurring monthly Price for `£1.99`.
2. Set `STRIPE_MONTHLY_PRICE_ID` to the test or live Price for that environment.
3. Enable Billing Portal in Stripe.
4. Point the Stripe webhook to `/api/stripe/webhook`.
5. Subscribe the webhook to:
   `checkout.session.completed`
   `customer.subscription.created`
   `customer.subscription.updated`
   `customer.subscription.deleted`
   `invoice.paid`
   `invoice.payment_failed`

Feature flag:

- `SUBSCRIPTION_TRIAL_ENABLED=false` keeps the current non-subscription access behaviour as rollback.
- `SUBSCRIPTION_TRIAL_ENABLED=true` enables the £1.99/month subscription flow with a 7-day free trial.

## Local Development

```bash
npm run dev
```

Open `http://localhost:3000`.

To test the cron route locally:

```bash
curl -H "Authorization: Bearer your-cron-secret" http://localhost:3000/api/reminders
curl -X POST -H "Authorization: Bearer your-scheduler-secret" http://localhost:3000/api/scheduler
```

## Deploying To Vercel

1. Push the project to GitHub.
2. Import the repository in Vercel.
3. Add all environment variables from `.env.example`.
4. Deploy.
5. Confirm the Vercel Cron entries are active for `/api/reminders` and `/api/scheduler`.

Suggested schedules:

- `/api/reminders` daily at `07:00 UTC`
- `/api/scheduler` Sunday `18:00 UTC`, Monday `08:00 UTC`, and Wednesday `08:00 UTC`

Rollback:

1. Set `SUBSCRIPTION_TRIAL_ENABLED=false`.
2. Redeploy.
3. The legacy non-subscription dashboard access path remains available while the Stripe trial flow is disabled.
