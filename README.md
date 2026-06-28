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
