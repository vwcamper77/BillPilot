# ClearTill email reminder operations

Status: implemented behind fail-closed flags; production enablement requires the checklist below.

## Architecture

The reminder system reuses the existing Next.js, Firestore, Firebase Authentication, Stripe, Resend, analytics and `emailDeliveries` infrastructure.

1. Stripe/preview state is normalised by `lib/entitlementResolver.server.js`.
2. `lib/reminders/lifecycle.server.js` creates a notification projection without replacing billing as the source of truth.
3. The hourly `/api/scheduler` run evaluates local time, preferences, stale balance, next-day bills and lifecycle transitions.
4. A Firestore transaction creates one durable `notificationEvents` document and claims the rolling routine window.
5. Send-time entitlement, bill, preference, verification and suppression checks run again.
6. Privacy-aware HTML and plain-text templates are sent through the existing Resend adapter and `emailDeliveries` ledger.
7. Signed Resend webhooks update delivery state and add hard-bounce or complaint suppressions.

`/api/reminders` remains the in-app bill-reminder generator. Email reminders are owned by `/api/scheduler`; the two jobs must not send duplicate email.

Payment-failure notices remain a separate transactional billing path triggered by the signed Stripe webhook. They do not consume the routine reminder cap and contain no financial amounts.

## Commercial lifecycle mapping

The immutable entry path and mutable access state are separate:

- `FREE_TRIAL / MANUAL_CONVERSION`: the current seven-day no-card preview. It expires without charge.
- `FREE_TRIAL / AUTO_RENEW`: a legacy authoritative Stripe `trialing` subscription. Exact price, currency, interval, trial end and cancellation route must be present before rendering.
- `DIRECT_PAID`: first active paid entitlement with no prior preview/trial.

A seamless preview-to-paid conversion remains `FREE_TRIAL`, preserves `reminderLifecycleStartedAt`, cancels trial-ending/expiry work and emits only the conversion confirmation. Billing and Stripe records remain authoritative; notification projection timestamps never grant access.

## Firestore records

Firestore is schemaless, so no destructive migration is required. Records are created lazily:

- `users/{uid}/notifications/lifecycle` — immutable entry path and notification projection;
- `users/{uid}/notifications/state` — routine cap, activity, backoff and pause state;
- `users/{uid}/settings/emailPreferences` — authenticated user preferences;
- `users/{uid}/notificationEvents/{hash}` — durable decisions and event status;
- `users/{uid}/reminderPreferenceAudits/{id}` — privacy-safe settings diffs;
- `emailDeliveries/{idempotencyKey}` — send claims and provider status;
- `emailSuppressions/{uid}` — bounce, complaint and administrative suppression;
- `emailProviderWebhookEvents/{svixId}` — webhook idempotency;
- `emailActionTokens/{tokenHash}` — one-time preference-link consumption.

These records are server-write-only. Account holders can read their lifecycle projection and preferences through existing authenticated surfaces.

## Configuration

Required provider configuration:

- `RESEND_API_KEY`
- `EMAIL_FROM_ADDRESS`
- `RESEND_WEBHOOK_SECRET`
- `EMAIL_LINK_SECRET`
- `SCHEDULER_SECRET` or `CRON_SECRET`
- `NEXT_PUBLIC_APP_URL` or `APP_URL`

Rollout controls:

- `REMINDER_EMAILS_ENABLED=false` — master enable;
- `REMINDER_ROUTINE_ENABLED=false` — balance, bill and setup nudges;
- `REMINDER_EMAILS_EMERGENCY_DISABLED=false` — emergency override;
- `REMINDER_LIFECYCLE_START_AT` — rollout ISO timestamp; suppresses historical welcomes for older accounts;
- `REMINDER_GUIDED_COHORT_PERCENT=50` — deterministic Guided/Light allocation;
- policy timing variables documented in `.env.example`.

Do not enable delivery until the sending domain has approved SPF, DKIM and DMARC, TLS delivery is confirmed, the monitored reply path is working, and the Resend webhook points to `/api/email/webhook`.

## Admin email operations board

Allowlisted administrators can open `/admin/email-operations` or follow **Email operations** from `/admin/analytics`. Access uses the existing verified Firebase session and `ADMIN_EMAILS` allowlist.

The board reports:

- **Fired** — ClearTill claimed the durable delivery record and began a provider attempt;
- **Provider accepted** — Resend accepted the API request and returned a provider message ID;
- **Delivered** — the recipient mail server accepted the message, as confirmed by the signed Resend webhook;
- **Delayed, bounced, complained or failed** — provider/webhook operational outcomes;
- **Activity after send** — a later authenticated ClearTill action, shown as an outcome signal without claiming causation;
- active suppressions and whether provider, webhook, scheduler and rollout configuration is present.

“Delivered” does not prove that a person read the email. Open tracking is deliberately not used for reminder decisions, and the board must not label provider-open events as verified reading. The API is admin-only, returns `private, no-store`, masks recipient addresses and does not expose rendered email bodies or financial values.

## Rollout

1. Deploy with all reminder flags false and set `REMINDER_LIFECYCLE_START_AT` to the intended production rollout timestamp.
2. Configure the Resend signing secret and send-domain DNS; confirm domain-level open and click tracking are disabled.
3. Confirm webhook signature, delivered, delayed, bounce and complaint events in a non-production Firebase project.
4. Complete privacy/legal review of service-message classification, templates, retention and Detailed mode.
5. Enable `REMINDER_EMAILS_ENABLED=true` with routine delivery still false. Verify FREE_TRIAL and DIRECT_PAID lifecycle notices using test accounts.
6. Enable routine reminders for a small operational cohort by setting `REMINDER_ROUTINE_ENABLED=true` and a deliberate `REMINDER_GUIDED_COHORT_PERCENT`.
7. Monitor decision reasons, provider outcomes, duplicate prevention, balance updates, bill reviews, opt-downs and complaints by entry path.
8. Increase exposure only when the kill criteria remain clear.

Rollback: set `REMINDER_EMAILS_EMERGENCY_DISABLED=true`. This stops new optional and lifecycle reminder sends without changing billing, access or user data. Leave the provider webhook enabled so already-sent delivery outcomes and suppressions remain recorded.

## Incident playbooks

### Billing-event race

- Inspect the Stripe event record and authoritative subscription/preview documents.
- Inspect the lifecycle projection and queued notification events.
- Never edit access from the notification projection.
- Re-run the scheduler after the authoritative billing state is correct. Send-time validation cancels stale messages.

### Duplicate investigation

- Compare notification `idempotencyKey`, event hash, `activeRoutineEventId` and the `emailDeliveries` record.
- Confirm whether the provider accepted one or several message IDs.
- Do not delete the audit trail. Cancel a stale event and repair the state claim only after the active send is resolved.

### Provider outage

- Set the emergency disable flag if failures are broad or state is uncertain.
- Failed events retry through the durable ledger up to the configured attempt limit; permanent failures are not retried.
- Do not bypass suppressions or send from an unapproved provider.

### Hard bounce or complaint

- Confirm the signed provider event and resulting `emailSuppressions/{uid}` record.
- Do not manually resend optional email to that user.
- Remove a suppression only after the address and user request have been verified under an approved support procedure.

### Trial conversion or expiry

- Confirm the authoritative preview/subscription state and source version.
- Conversion must cancel ending, expiry and setup events without resetting preference or cadence age.
- Expiry must cancel routine balance and bill events.

## Privacy and retention

Private mode is the default and contains no balance, amount or bill name. Detailed mode is explicit and warns about inbox previews, forwarding and shared devices. Subjects and preheaders never contain financial amounts. Open pixels are disabled and email opens are not an outcome signal.

Starting operational retention targets—subject to formal approval—are 90 days for send events, no persisted rendered bodies, prompt expiry cleanup for action-token records, and preference audit retention for the approved account lifecycle. A scheduled retention job is not included and must be approved before production enablement.

Review current authoritative guidance before enablement:

- [ICO: direct marketing and service messages](https://ico.org.uk/for-organisations/advice-for-small-organisations/direct-marketing-and-data-protection/marketing-and-data-protection-in-detail/)
- [ICO: data protection by design and default](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/data-protection-by-design-and-by-default/)
- [ICO: electronic-mail tracking considerations](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-direct-marketing-using-electronic-mail/what-else-do-we-need-to-consider/)
- [OWASP: short-lived, single-use email-token patterns](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
- [Google: email sender requirements](https://support.google.com/mail/answer/81126?hl=en)
- [Resend: verify webhook signatures](https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests)

## Cheapest next validation

Use the non-production Firebase and Resend test configuration to run two accounts through the same fixed clock:

1. no-card preview -> trial welcome -> ending -> expiry; and
2. direct paid -> paid welcome.

Then create two next-day bills, stale the balance, run the scheduler twice concurrently and verify exactly one private combined email, one event, one delivery record and one provider message ID.
