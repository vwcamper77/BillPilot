---
name: cleartill-email-reminders
description: Design, implement, review, or repair ClearTill's privacy-sensitive email reminder system, including distinct 7-day free-trial and direct-to-paid entry paths. Use for entry-path lifecycle states and templates, notification preferences, cadence and adaptive backoff, scheduling, merging and deduplication, secure deep links, provider webhooks, suppression, analytics, tests, and rollout controls. Do not use for broad marketing campaigns, payment execution, or unrelated transactional email.
---

# ClearTill email reminder system

## Mission

Implement a useful, low-noise reminder system that helps users keep their ClearTill balance current and review bills expected the following day.

The product decision is **PIVOT, then TEST**:

- Do not default every new user to indefinite daily email.
- Treat `FREE_TRIAL` and `DIRECT_PAID` as distinct commercial entry paths with different lifecycle emails.
- Keep commercial entry path separate from reminder mode: either entry path may use Guided, Daily, Weekly, Bills-only, or Off.
- Use a short high-contact onboarding period, then taper automatically.
- Keep bill reminders event-driven and independent from routine balance cadence.
- Send only when the user has a relevant action to take.
- Suppress, combine, or back off messages when additional contact is unlikely to help.

Treat this file as the authoritative product and engineering specification. Adapt names and implementation details to the repository's existing architecture, but do not weaken the privacy, security, deduplication, frequency-cap, or test requirements.

## Scope boundaries

Use this skill for:

- commercial entry-path detection for 7-day trial and direct-to-paid users;
- trial start, trial-ending, conversion, expiry, and paid-activation service emails;
- entry-path-specific onboarding reminder configuration and copy;
- stale-balance reminders;
- next-day bill reminders;
- combined bill-and-balance reminders;
- user reminder preferences and snoozing;
- cadence tapering and inactivity pauses;
- scheduling in the user's local timezone;
- email rendering, delivery, webhooks, suppression, and audit records;
- secure links back to the relevant ClearTill task;
- feature flags, experiments, operational metrics, and tests.

Do not use this skill to:

- send broad marketing, promotions, referrals, testimonials, cross-sells, or urgency-led conversion campaigns;
- hide promotional content inside service reminders; factual trial-status, expiry, auto-renewal, conversion, and paid-activation notices are permitted, while any promotional plan offer must use the separately approved marketing or lifecycle-consent path;
- initiate, approve, guarantee, or represent that ClearTill has executed a payment;
- implement SMS or push notifications unless separately requested;
- use machine learning to optimise send time in the first version;
- use email-open pixels as the principal engagement signal;
- replace existing account-security or authentication controls.

## Required working method

1. Inspect the repository before editing. Identify the application framework, database and migration system, billing/subscription source of truth, 7-day trial conversion rules, entitlement checks, background-job or scheduler infrastructure, email provider, authentication flow, feature-flag mechanism, analytics conventions, localisation approach, and test stack.
2. Reuse existing abstractions and naming conventions. Do not create a second queue, email subsystem, preference store, or authentication mechanism when a suitable one already exists.
3. Produce a concise implementation plan tied to concrete files and components before making broad changes.
4. Make the smallest coherent production-grade implementation. Prefer deterministic rules over unnecessary abstractions.
5. Keep policy values configurable rather than scattering magic numbers through the code.
6. Add or update tests with each functional change.
7. Run the repository's formatter, linter, type checker, unit tests, integration tests, and relevant end-to-end tests before finishing.
8. Do not commit secrets, provider credentials, live customer data, or raw authentication tokens.
9. Report assumptions, changed files, migrations, commands run, test results, rollout steps, and unresolved risks in the final response.

If the repository lacks a required subsystem, implement the narrowest compatible abstraction and document the decision. Do not silently invent a large platform rewrite.

# Commercial entry paths and lifecycle

## Two independent axes

Do not model the user's commercial entry path as a reminder mode. They answer different questions:

```text
commercial_entry_path = FREE_TRIAL | DIRECT_PAID
reminder_mode = GUIDED | DAILY | WEEKDAYS | THREE_PER_WEEK | WEEKLY | BILLS_ONLY | OFF
```

A trial user may choose any reminder mode, and a direct-paid user may choose any reminder mode. Persist and test both dimensions independently.

`commercial_entry_path` records how the user first entered the product and should be immutable for analytics and audit. Current access is represented separately by a billing or entitlement lifecycle state such as:

```text
TRIAL_ACTIVE
PAID_ACTIVE
TRIAL_EXPIRED
PAST_DUE
CANCELLED
```

Map these names to the repository's existing billing model rather than creating competing subscription state.

## Billing source of truth

The email system must consume authoritative billing/subscription events or query the existing entitlement service. It must not infer trial or paid status from account age, email history, a local timer, or whether a payment method appears present.

Before implementation, determine whether the 7-day trial:

- automatically becomes a paid subscription; or
- expires without charge and requires a separate purchase.

Represent this explicitly as `AUTO_RENEW` or `MANUAL_CONVERSION`, or reuse the repository's equivalent. Never guess. Copy, timing, cancellation links, and required disclosures differ materially between the two cases.

For an auto-renewing trial, source the exact first charge date, price, billing interval, currency, tax treatment where applicable, and cancellation route from the billing system. For a manual-conversion trial, state clearly that the user will not be charged automatically. Do not render fallback copy that could misstate either condition.

Re-check entitlement immediately before rendering or sending, not only when scheduling. Billing webhooks, early conversion, cancellation, and expiry may occur after an event was queued.

## Entry path A: 7-day free trial

Use the following default lifecycle. Timings are relative to the authoritative `trial_ends_at`, not hard-coded calendar-day labels.

| Event | Default timing | Eligibility | Behaviour |
|---|---|---|---|
| Trial welcome and reminder setup | Immediately after verified signup and `TRIAL_ACTIVE` | Not previously sent for this trial version | Explain the exact trial end, conversion type, reminder controls, and privacy mode |
| Trial setup nudge | 24 hours after trial start | No first-value action, no setup completed, no higher-priority email due | One contextual nudge; subject to the routine cap |
| Trial ending soon | 48 hours before `trial_ends_at`, configurable | Trial still active and not already converted/cancelled | State exact end date/time and either auto-renewal terms or no-auto-charge expiry behaviour |
| Trial converted to paid | On authoritative transition to `PAID_ACTIVE` | Entry path was `FREE_TRIAL` | Confirm paid access and that reminder settings continue; do not send the direct-paid welcome as well |
| Trial expired | On authoritative transition to `TRIAL_EXPIRED` | No paid entitlement | Explain the access/reminder effect factually and pause ineligible routine reminders |

Requirements:

- Continue eligible balance and next-day bill reminders during an active trial.
- All trial onboarding nudges are subject to stale-balance checks, merging, suppression, and the one-routine-email-per-24-hours cap.
- Contractually or legally required subscription billing notices use their existing billing-notice path and may bypass the routine cap; do not merge them into a financial reminder.
- A non-required trial-ending service email takes priority over a same-day setup or balance nudge. Preserve an eligible next-day bill alert according to the product's service-priority policy; do not silently discard a required or safety-relevant bill notice.
- When a trial converts early, cancel pending trial-ending and trial-expiry events.
- When a trial expires, cancel queued balance and bill reminders that the expired entitlement no longer permits.
- Preserve the user's reminder preferences and lifecycle age through a seamless trial-to-paid conversion. Do not restart another seven days of daily onboarding reminders.
- Do not send both `TRIAL_CONVERTED_TO_PAID` and `DIRECT_PAID_WELCOME` for the same activation.
- Do not insert testimonials, discounts, countdown pressure, or plan upsells into trial service notices. A promotional conversion campaign is a separate system with separate approval and consent logic.

A first-value action is an authenticated first-party action such as configuring reminders, updating the balance, adding/importing a bill, or reviewing the relevant dashboard. Email opens do not qualify.

## Entry path B: direct to paid

Use this lifecycle when the user's first active entitlement is paid and no trial was started:

| Event | Default timing | Eligibility | Behaviour |
|---|---|---|---|
| Direct-paid welcome and reminder setup | Immediately after verified signup and `PAID_ACTIVE` | Entry path is `DIRECT_PAID`; not previously sent for this activation | Confirm paid access, introduce balance/bill reminders, and link to settings; contain no trial countdown or conversion language |
| Paid setup nudge | 24 hours after paid activation | No first-value action, no setup completed, no higher-priority email due | One contextual setup nudge; subject to the routine cap |
| Guided reminder lifecycle | From paid activation/onboarding start | Active paid entitlement | Apply the normal stale-balance and bill-reminder policy |

Requirements:

- Do not send trial-start, trial-ending, trial-expiry, or trial-conversion copy to direct-paid users.
- Do not duplicate the billing provider's receipt, invoice, or payment confirmation. Link to the existing billing area when appropriate.
- Do not describe paid access as temporary or imply that the user still needs to convert.
- If a paid activation follows an expired trial after a material gap, use the repository's reactivation lifecycle if one exists. Do not misclassify it as a brand-new direct-paid signup merely to reuse copy.

## Reminder lifecycle age

Use a dedicated `reminder_lifecycle_started_at` or an equivalent derived value:

- for `FREE_TRIAL`, start at verified trial activation;
- for `DIRECT_PAID`, start at verified paid activation or completed onboarding, following existing product semantics;
- for seamless trial-to-paid conversion, keep the original trial start so the cadence continues into days 8-30 rather than restarting;
- for a later reactivation after expiry, follow an explicit reactivation policy rather than silently resetting.

This timestamp controls Guided cadence only. It must not be used as the subscription source of truth.

## Lifecycle priority and cancellation

Use this priority model, while preserving any stricter existing billing-notice rules:

```text
Security / legally required billing notice
Account entitlement transition (converted, expired, cancelled)
Trial ending service notice
Next-day bill reminder or combined bill-and-balance reminder
Routine balance reminder
Setup or educational nudge
Marketing — always separate
```

Every queued lifecycle email must have a cancellation predicate. Examples include early conversion, trial cancellation, trial expiry, paid activation, account closure, later entitlement change, bounce/complaint suppression, and user preference changes. Re-evaluate the predicate at send time.

# Product policy

## Core principle

> Send when there is a useful action to take, not merely because another day has passed.

A routine reminder must not be sent when:

- the balance is current;
- the user has disabled or snoozed that reminder category;
- an equivalent reminder was already sent inside the applicable cap window;
- the relevant bill is cancelled, completed, deleted, or no longer due;
- the account or email address is suppressed;
- the reminder would disclose more financial information than the user's privacy setting permits.

## Recommended default: Guided mode

Use the following default cadence while the user's balance is stale:

| User age | Balance reminder cadence |
|---|---|
| Days 1-7 after verified signup | Daily |
| Days 8-30 | Three times per week |
| Days 31-60 | Twice per week |
| Day 61 onward | Weekly |

Requirements:

- Base Guided cadence on `reminder_lifecycle_started_at` as defined by the commercial entry path. Do not infer entitlement from this timestamp.
- Preserve cadence age through a seamless trial-to-paid conversion so the user does not receive a second seven-day daily sequence.
- Do not send a balance reminder merely because a cadence slot exists; the balance must also be stale and the user must have an eligible active entitlement.
- Define the default stale threshold as 24 hours, configurable per user or product policy.
- Guided mode may automatically taper according to behaviour.

## User-selectable modes

Expose these modes when compatible with the product UI:

- `GUIDED` — recommended default; follows the lifecycle above and may taper.
- `DAILY` — daily while stale.
- `WEEKDAYS` — Monday to Friday while stale.
- `THREE_PER_WEEK` — use deterministic configured weekdays.
- `WEEKLY` — use a deterministic configured weekday.
- `BILLS_ONLY` — no routine balance reminder.
- `OFF` — no optional balance or bill reminders, subject to separately classified critical account messages.

A user who explicitly selects permanent daily reminders may disable automatic tapering. Routine caps, stale-balance checks, quiet hours, merging, suppressions, and privacy rules still apply.

## Next-day bill reminders

Default behaviour:

- Notify once for bills due on the following local calendar day.
- Schedule the reminder for 18:00 in the user's local timezone.
- Group multiple bills into one digest.
- Merge with a due balance reminder when the balance is stale.
- Cancel any pending reminder if the bill is cancelled, paid, completed, deleted, rescheduled, or otherwise no longer eligible.

Wording must reflect data certainty:

| Source quality | Permitted wording |
|---|---|
| User-entered or imported scheduled bill | "Scheduled for tomorrow" |
| Predicted from historical activity | "Expected tomorrow" |
| Confirmed pending transaction | "Pending for tomorrow" |

Never say that a bill "will be paid", "is going out", or has been guaranteed unless ClearTill has authoritative confirmation and the product actually controls that payment state.

## Adaptive backoff

Apply only to Guided mode unless the user explicitly allows it for another mode.

1. Count consecutive routine balance reminders that are not followed by meaningful activity within the configured attribution window.
2. After three such reminders, move the user down one cadence tier.
3. Explain the reduction inside the next relevant message or settings surface; do not create a gratuitous extra email solely to announce it.
4. After 30 consecutive days without meaningful activity, pause routine balance reminders.
5. Before or at the pause, send at most one factual pause notice.
6. Keep bill reminders active when the user has left them enabled.
7. A later return must not silently restore daily reminders; retain the current setting or ask the user to increase it.

Meaningful activity is first-party product activity such as:

- updating the balance;
- reviewing the relevant bill screen;
- visiting the relevant authenticated ClearTill task;
- changing reminder preferences.

Do not use an email open as the decisive activity signal.

## Frequency and combination rules

- Maximum: one routine ClearTill email per user per rolling 24 hours, including setup nudges and non-required trial lifecycle nudges.
- Security and legally/contractually required billing notices follow their own caps and must not be hidden inside routine reminder emails.
- Account-state transition emails must be deduplicated by subscription/trial version and must suppress lower-priority setup or balance nudges due in the same cap window.
- Maximum: one reminder per bill per selected lead time and due-date version.
- Combine multiple eligible bills into one digest.
- Combine a stale-balance reminder with a next-day bill reminder.
- Security and account-critical messages are separate and may bypass routine caps under their own policy.
- Marketing messages must use separate consent, templates, streams, preferences, suppressions, and analytics. Never insert promotional modules into service reminders.

# User preferences

Implement or extend a preference surface with these values, using existing UI and API conventions:

| Setting | Recommended default |
|---|---|
| Balance reminder mode | Guided |
| Balance stale threshold | 24 hours |
| Preferred reminder time | 18:00 local time |
| Bill reminders | On |
| Bill lead time | One day before |
| Multiple bills | Single digest |
| Quiet hours | 20:00-08:00 local time |
| Email financial detail | Private |
| Snooze | None; offer 1 day, 3 days, and 1 week |
| Marketing | Off unless separately and validly opted in |
| Email-open tracking | Off |
| Guided auto-taper | On |

Every optional reminder email must contain a direct route to reminder settings and an appropriate pause or snooze action. Changing a reminder preference must be authenticated or protected by a narrowly scoped, expiring token; a raw GET request must not perform a sensitive state change.

Use entry-path-specific onboarding explanations rather than one generic message.

For an active trial:

> Your 7-day trial ends on {{trial_end_date}}. Guided reminders are daily during the first seven days while your balance is out of date, then become less frequent if you continue with paid access. Bills are normally flagged the evening before. You can pause or change reminders at any time.

For direct-paid activation:

> Your paid ClearTill access is active. Guided reminders are daily during the first seven days while your balance is out of date, then gradually less frequent. Bills are normally flagged the evening before. You can pause or change reminders at any time.

If the trial is auto-renewing, add the approved exact price/date/cancellation disclosure. If it expires without charge, state that clearly.

# Eligibility and policy engine

Centralise send decisions in one deterministic policy service. Avoid duplicating decision logic across schedulers, controllers, and template code.

Use this decision order:

```text
1. If the account is closed, the address is hard-bounced/complained, or a global suppression applies: send nothing optional.
2. Load the authoritative commercial entry path, current entitlement, trial conversion type, and current subscription/trial version.
3. If a separately classified security or required billing event exists: process it through its dedicated path.
4. Resolve an eligible account-lifecycle transition or trial-ending event; cancel stale queued events from prior states.
5. If the user lacks an entitlement that permits routine reminders: send only the eligible account-state notice, otherwise send nothing routine.
6. Resolve the user's local date, local time, quiet hours, preferences, and snooze state.
7. Load eligible bills due on the following local calendar day.
8. Determine whether the balance is stale.
9. If bills are eligible and the balance is stale: create one combined reminder.
10. Else if bills are eligible: create one bill digest.
11. Else if the balance is stale and the selected cadence is due: create one balance reminder.
12. Else if an entry-path setup nudge is due and no first-value action exists: create the correct trial or direct-paid nudge.
13. Else: create no notification.
14. Apply lifecycle priority, the rolling 24-hour routine cap, deduplication, idempotency, send-time entitlement revalidation, and suppression rules.
15. Queue the resulting event for rendering and delivery.
```

Return a structured decision result containing at least:

- eligibility status;
- selected notification type;
- reasons for send or suppression;
- relevant entity IDs;
- commercial entry path, entitlement state, trial conversion type, and source subscription/trial version used for the decision;
- scheduled local and UTC times;
- privacy mode;
- idempotency key;
- policy version.

Persist the decision reason sufficiently to explain why a message was or was not sent without storing unnecessary financial detail.

# Architecture

Prefer this logical flow, mapped onto the repository's existing components:

```text
Balance updates --------\
Bill lifecycle -----------+--> notification event/eligibility layer
Billing/entitlement events-+                 |
Onboarding/settings ------/                  |
                                        v
                              policy + cadence engine
                                        |
                              merge / cap / deduplicate
                                        |
                                        v
                                  durable send queue
                                        |
                                        v
                               privacy-aware renderer
                                        |
                                        v
                               email delivery provider
                                        |
                                        v
                       delivery / bounce / complaint webhooks
```

The scheduler must be safe to run repeatedly. Queue retries, overlapping scheduler executions, process restarts, and provider webhook retries must not produce duplicate user messages.

# Data model

Adapt these logical records to existing database conventions. Extend existing tables where appropriate rather than blindly creating duplicates.

## Commercial lifecycle projection

Prefer the existing billing/subscription tables and event stream as the source of truth. Add a notification-oriented projection only when necessary for reliable scheduling and audit. It may contain:

- immutable original entry path (`FREE_TRIAL` or `DIRECT_PAID`);
- current entitlement or subscription-state reference;
- billing-provider subscription/trial ID or stable internal equivalent;
- subscription/trial version or event sequence;
- trial start and exact trial end timestamps;
- conversion type (`AUTO_RENEW` or `MANUAL_CONVERSION`);
- paid activation, conversion, expiry, cancellation, and reactivation timestamps as applicable;
- `reminder_lifecycle_started_at`;
- first-value action timestamp;
- last synchronised billing event/version.

Do not duplicate mutable price, plan, tax, or payment-method data unless the existing architecture requires a versioned snapshot for a specific sent notice. When rendering an auto-renewal notice, source authoritative terms and persist only the minimum audit metadata needed to prove which version was sent.

## Notification preference

Store at least:

- user/account ID;
- IANA timezone;
- balance reminder mode;
- preferred local reminder time;
- stale threshold;
- bill reminder enabled state;
- bill lead time or lead-time set;
- digest preference;
- quiet-hours start and end;
- privacy mode (`PRIVATE` or `DETAILED`);
- snooze-until timestamp;
- Guided auto-taper state;
- current cadence tier, where needed;
- marketing preference in a separate field or subsystem;
- created and updated timestamps.

Validate timezone and local-time input. Preserve daylight-saving behaviour by using IANA timezone identifiers rather than fixed UTC offsets.

## Notification event

Store at least:

- user/account ID;
- event type;
- commercial entry path and entitlement-state snapshot;
- source subscription/trial ID and version for lifecycle events;
- relevant bill IDs or a stable event-to-entity relation;
- scheduled send time in UTC plus the intended local date/time;
- priority/category;
- privacy classification;
- status;
- policy version;
- decision reason;
- idempotency/deduplication key;
- created, queued, cancelled, and processed timestamps.

Suggested event types:

```text
TRIAL_WELCOME
DIRECT_PAID_WELCOME
TRIAL_SETUP_NUDGE
PAID_SETUP_NUDGE
TRIAL_ENDING_SOON
TRIAL_CONVERTED_TO_PAID
TRIAL_EXPIRED
BALANCE_STALE
BILL_DUE_TOMORROW
BILL_AND_BALANCE_STALE
BALANCE_BACKOFF
BALANCE_REMINDERS_PAUSED
PREFERENCES_CHANGED
SECURITY_ALERT
```

Use repository-appropriate enums and naming.

## Notification send

Store at least:

- notification event ID or included event IDs;
- template ID and template version;
- provider message ID;
- queued, sent, delivered, deferred, bounced, complained, and failed timestamps as applicable;
- suppression or failure reason;
- retry count;
- redacted rendering metadata.

Do not persist rendered financial content unless there is a documented operational need and retention policy.

## Preference audit

Record:

- user/account ID;
- old and new values or a privacy-preserving diff;
- source of change: user, administrator, migration, or automatic policy;
- actor identity where appropriate;
- timestamp;
- reason for automatic changes.

## Suppression record

Reuse an existing suppression subsystem where possible. It must support at least:

- hard bounce;
- complaint/spam report;
- invalid address;
- account closure;
- user category opt-out;
- administrator suppression;
- provider-level suppression reconciliation.

# Idempotency and concurrency

Construct a stable key that represents the user, message purpose, relevant entity version, due date, and lead time. For example:

```text
user_id:event_type:subscription_or_trial_version:sorted_bill_ids:due_local_date:lead_time:policy_version
```

Requirements:

- Enforce uniqueness in durable storage, not only in application memory.
- Use transactions, row locks, compare-and-set state changes, or equivalent repository patterns to prevent concurrent duplicate creation.
- Treat queue publication as retryable and idempotent.
- For trial and paid lifecycle emails, include the authoritative subscription/trial version so a transition is sent once and stale events are cancelled safely.
- Verify billing and email-provider webhook signatures and process webhook event IDs idempotently.
- Cancel rather than delete pending events when an audit trail is useful.

# Time and scheduling semantics

- Use the user's IANA timezone.
- Treat "tomorrow" as the following calendar date in that timezone, not `now + 24 hours`.
- Store bill due dates as dates when no exact payment time exists.
- Convert the chosen local send time to UTC at scheduling time using timezone-aware libraries.
- Correctly handle daylight-saving transitions, nonexistent local times, ambiguous local times, leap days, month/year boundaries, and users who change timezone.
- Show trial end and subscription-start times in the user's current IANA timezone while retaining the authoritative UTC timestamp.
- Calculate 48-hours-before-trial-end as elapsed time from the authoritative end timestamp; do not derive it from a guessed 'day 5' label.
- If the user's preferred time falls inside quiet hours, move the reminder to the nearest permitted time according to a documented rule.
- Do not send a late next-day reminder after the bill's due date has started unless product policy explicitly permits a catch-up message.
- Make scheduler lookahead and retry windows configurable.

# Email privacy modes

## Private mode — default

Permitted content:

- number of approaching bills;
- scheduled date;
- when the balance was last reviewed in non-sensitive relative terms;
- a secure link to the relevant ClearTill screen.

Do not include:

- current balance;
- bill amount;
- account or card number;
- bank name;
- full creditor/bill name when it may reveal sensitive information;
- statements such as "you cannot afford this bill";
- sensitive financial content in the subject or preheader.

Acceptable subject:

> A bill is scheduled for tomorrow

Unacceptable subject:

> Your £1,250 rent leaves only £46 in your account

## Detailed mode — explicit user choice

Detailed mode may include bill name, amount, and due date in the email body after an explicit preference change. Even in Detailed mode:

- do not put balances or amounts in the subject line;
- explain that inbox previews, shared devices, forwarding, and compromised email accounts may expose the content;
- minimise provider metadata and logs;
- permit the user to return to Private mode easily.

# Canonical templates

Use the repository's existing email component system, brand tokens, accessibility rules, localisation infrastructure, and plain-text fallback. Keep copy factual, calm, and non-judgmental. Do not use shame, urgency theatre, or promotional content.

Every CTA must route to the exact relevant task after authentication.

## Trial welcome and reminder setup

**Template ID:** `trial_welcome_reminder_setup`

**Subject:** Your 7-day ClearTill trial is active
**Preheader:** Set up reminders and review what happens on {{trial_end_date}}.

```text
Hi {{first_name}},

Your 7-day ClearTill trial is active until {{trial_end_date}} at {{trial_end_time}} {{timezone_label}}.

ClearTill can remind you when your balance may need reviewing and when a bill is scheduled for the following day. Guided reminders are daily during the first seven days while your balance is out of date, then become less frequent if paid access continues.

{{trial_conversion_disclosure}}

[Set up ClearTill reminders]

[Review trial and billing settings]

You can change, pause, or switch off optional reminders at any time.
```

`trial_conversion_disclosure` must be selected from authoritative billing state:

- Auto-renewing: "Unless you cancel before the trial ends, your {{plan_name}} subscription is scheduled to begin on {{first_charge_date}} at {{formatted_price}} per {{billing_interval}}." Include the approved cancellation route.
- Manual conversion: "Your trial will end on {{trial_end_date}}. You will not be charged automatically." Do not imply that access will continue.

Do not put price or payment details in the subject or preheader. Do not render this template until the trial end and conversion terms are known.

## Direct-paid welcome and reminder setup

**Template ID:** `direct_paid_welcome_reminder_setup`

**Subject:** Welcome to ClearTill
**Preheader:** Your paid access is active. Choose your balance and bill reminders.

```text
Hi {{first_name}},

Your paid ClearTill access is active.

ClearTill can remind you when your balance may need reviewing and when a bill is scheduled for the following day. We recommend Guided reminders: daily during your first seven days while your balance is out of date, then gradually less often.

[Set up ClearTill reminders]

[Review account settings]

You can change, pause, or switch off optional reminders at any time.
```

Do not include trial, conversion, countdown, or upgrade language. Do not duplicate the separate payment receipt or invoice.

## Trial setup nudge

**Template ID:** `trial_setup_nudge`

**Subject:** Finish setting up ClearTill
**Preheader:** Your trial runs until {{trial_end_date}}.

```text
Hi {{first_name}},

Your ClearTill trial runs until {{trial_end_date}}. Set your reminder preferences and add or review your balance so upcoming-bill reminders can be useful.

[Continue setup]

[Review trial status] · [Change reminder settings]
```

Send at most once, only when there has been no first-value action and no higher-priority email is due. Use the exact end date rather than an anxiety-inducing countdown.

## Direct-paid setup nudge

**Template ID:** `direct_paid_setup_nudge`

**Subject:** Finish setting up your ClearTill reminders
**Preheader:** Choose how balance and bill reminders should work.

```text
Hi {{first_name}},

Your paid ClearTill access is active, but your reminder setup is not complete.

Choose how often ClearTill should prompt you to review your balance and whether to send a reminder before a scheduled bill.

[Finish reminder setup]

[Change reminder settings]
```

Send at most once, only when there has been no first-value action and no higher-priority email is due.

## Trial ending soon — auto-renewing

**Template ID:** `trial_ending_soon_auto_renew`

**Subject:** Your ClearTill trial ends on {{trial_end_date}}
**Preheader:** Your paid subscription is scheduled to start after the trial.

```text
Hi {{first_name}},

Your ClearTill trial ends on {{trial_end_date}} at {{trial_end_time}} {{timezone_label}}.

Unless you cancel before then, your {{plan_name}} subscription is scheduled to begin on {{first_charge_date}} at {{formatted_price}} per {{billing_interval}}.

[Review subscription and billing]

[Manage or cancel trial]

Your existing reminder settings will continue if paid access becomes active.
```

Use only for an authoritative auto-renewing trial. Do not send when the user has already converted, cancelled, or moved to another plan. Price, date, currency, interval, and cancellation route must come from the billing source of truth.

## Trial ending soon — no automatic charge

**Template ID:** `trial_ending_soon_manual_conversion`

**Subject:** Your ClearTill trial ends on {{trial_end_date}}
**Preheader:** Routine reminders will pause if paid access does not continue.

```text
Hi {{first_name}},

Your ClearTill trial ends on {{trial_end_date}} at {{trial_end_time}} {{timezone_label}}. You will not be charged automatically.

If paid access is not active when the trial ends, routine balance and bill reminder emails will pause according to the ClearTill access policy.

[Review trial status]

[Review reminder settings]
```

Do not insert a discount, testimonial, artificial countdown, or upgrade promotion into this service notice.

## Trial converted to paid

**Template ID:** `trial_converted_to_paid`

**Subject:** Your ClearTill paid access is active
**Preheader:** Your reminder settings will continue.

```text
Hi {{first_name}},

Your ClearTill trial has ended and your paid access is active.

Your existing balance and bill reminder settings will continue. We have not restarted the seven-day onboarding cadence.

[Review ClearTill]

[Review reminder settings]
```

Do not also send the direct-paid welcome. Do not duplicate the payment receipt, invoice, or card details.

## Trial expired

**Template ID:** `trial_expired`

**Subject:** Your ClearTill trial has ended
**Preheader:** Routine reminders are paused because paid access is not active.

```text
Hi {{first_name}},

Your ClearTill trial ended on {{trial_end_date}}. Paid access is not active, so routine balance and bill reminder emails are paused.

{{post_trial_access_summary}}

[Review account status]

[Manage reminder settings]
```

`post_trial_access_summary` must use approved product policy for data access, retention, and reactivation. Do not claim that data is deleted, retained indefinitely, or inaccessible unless that is true. Any promotional plan offer must be sent through the separately approved marketing or lifecycle-consent path.

## Balance reminder

**Template ID:** `balance_stale_reminder`

**Subject:** Your ClearTill balance may need updating
**Preheader:** It was last reviewed {{relative_time}}.

```text
Hi {{first_name}},

Your ClearTill balance was last reviewed {{relative_time}}. Updating it helps keep your upcoming-bill view accurate.

[Review or update balance]

[Snooze for three days] · [Change reminder frequency]
```

Do not use language such as "You forgot" or "You still haven't updated".

## Bill reminder — Private mode

**Template ID:** `bill_due_tomorrow_private`

**Subject:** {{bill_count_subject}}
**Preheader:** Review {{tomorrow_date}} securely in ClearTill.

```text
Hi {{first_name}},

You have {{bill_count}} {{bill_or_bills}} scheduled for tomorrow, {{tomorrow_date}}.

[Review tomorrow's bills]

Financial details are hidden from this email. You can change this in reminder settings.
```

Use "A bill is scheduled for tomorrow" for one bill and a count-based subject for several bills. Substitute "expected" or "pending" when required by source certainty.

## Combined bill and balance reminder

**Template ID:** `bill_and_balance_reminder`

**Subject:** {{bill_count_subject}}
**Preheader:** Your ClearTill balance was last reviewed {{relative_time}}.

```text
Hi {{first_name}},

You have {{bill_count}} {{bill_or_bills}} scheduled for tomorrow. Your ClearTill balance was last reviewed {{relative_time}}.

Review your bills and update your balance in one place.

[Review and update]

[Snooze routine balance reminders] · [Manage bill alerts]
```

This template replaces two separate routine messages.

## Automatic backoff notice

**Template component ID:** `guided_backoff_notice`

Prefer a component inside the next relevant message or settings UI:

```text
We're reducing routine reminders

There has not been a balance update following recent reminders, so Guided mode is moving from daily to three times per week. Bill alerts are unchanged.

[Keep daily reminders] · [Use fewer reminders] · [Pause]
```

Use the actual previous and next tiers rather than hard-coded copy.

## Routine reminders paused

**Template ID:** `balance_reminders_paused`

**Subject:** Routine balance reminders are paused
**Preheader:** Your bill alerts remain unchanged.

```text
Hi {{first_name}},

We have paused routine balance emails because there has not been a balance update or relevant ClearTill activity for 30 days.

Your enabled bill alerts will continue.

[Review reminder settings]

You can resume balance reminders whenever they are useful.
```

## Preference confirmation

**Template ID:** `reminder_preferences_changed`

**Subject:** Your ClearTill reminder settings were updated

```text
Your reminder settings are now:

Balance reminders: {{balance_cadence}}
Reminder time: {{local_time}}
Bill alerts: {{bill_lead_time}}
Email detail: {{privacy_mode}}

[Review settings]

If you did not make this change, sign in to ClearTill and review your account security.
```

# Secure deep links

Easy access means routing users to the exact task with normal security controls intact.

Suggested routes, adapted to the application:

```text
/balance/update
/bills/tomorrow
/settings/reminders
```

Requirements:

- If the user has a valid authenticated session, open the target screen directly.
- Otherwise authenticate and return to the original target.
- Use cryptographically random, short-lived, single-use tokens only when passwordless access is an approved existing pattern.
- Recommended token lifetime: 15 minutes, configurable.
- Store a hash of the token, not the raw token.
- Bind a token to one user, one purpose, and one intended route.
- Invalidate after successful use and on relevant security changes.
- Do not include balances, email addresses, raw user IDs, bill names, or amounts in the URL.
- A GET request must not directly update a balance, disable security, or make another consequential change.
- Require stronger authentication for bank connections, email changes, payment settings, and other high-risk actions.
- Prevent open redirects by using an allowlist or server-side route identifiers.
- Redact tokens from logs, analytics, referrers, and error reporting.

# Privacy, security, and compliance guardrails

Implement these as engineering controls, while leaving final legal-basis and policy approval to ClearTill's responsible legal/privacy owner.

- Private mode is the default.
- Send trial and paid lifecycle emails only to a verified account email through the approved service-message path.
- Treat trial status, subscription state, plan, price, and renewal timing as account data; keep prices and payment details out of subjects and preheaders.
- For auto-renewing trials, display the exact approved price/date/cancellation disclosure without adding balance, bank, card, or bill details.
- Apply data minimisation to templates, provider payloads, logs, analytics, and support tooling.
- Keep service reminders and marketing operationally separate.
- Do not add promotions to service templates.
- Do not use open-tracking pixels in the first version.
- Use delivery, bounce, complaint, CTA, in-product update, and preference-change events instead.
- Encrypt data in transit and at rest using existing platform standards.
- Apply role-based access to reminder and audit data.
- Verify provider webhook signatures.
- Redact financial values, tokens, and unnecessary identifiers from logs.
- Define and document retention periods; avoid retaining rendered bodies where practical.
- Support account deletion and privacy-rights workflows through existing data lifecycle mechanisms.
- Record automated preference changes and make them explainable to the user.
- Use provider agreements, subprocessors, and transfer controls approved for the product.
- Run a privacy/security review before enabling production delivery.

Suggested starting retention configuration, subject to formal approval:

- operational send events: 90 days;
- rendered email bodies: do not store, or retain only for a short controlled debugging period;
- preference audit: account lifetime plus the approved post-closure period;
- expired authentication tokens: remove promptly;
- suppression identifiers: retain only as needed to prevent prohibited or unwanted re-contact.

Do not present these starting values as universal legal requirements. Make them configurable and documented.

# Deliverability and provider integration

Reuse the existing provider when suitable. The production setup must support:

- authenticated sending domain;
- SPF, DKIM, and DMARC configuration outside the application code;
- TLS transport;
- separate service and marketing streams or equivalent categorisation;
- bounce and complaint webhooks;
- hard-bounce and complaint suppression;
- retry with bounded exponential backoff for transient errors;
- dead-letter or failure inspection for exhausted retries;
- a monitored reply path rather than an unmonitored no-reply address where operationally possible;
- provider message IDs for reconciliation without excessive content retention.

Do not retry permanent failures. Do not repeatedly send to a complained or hard-bounced address.

# Observability and product measurement

Instrument outcomes, not vanity metrics.

Track at least:

- notification decisions by send and suppression reason, segmented by `FREE_TRIAL` and `DIRECT_PAID`;
- trial welcome, setup, ending, conversion, and expiry events by authoritative billing state;
- incorrect-state prevention, including queued trial emails cancelled after conversion or cancellation;
- messages queued, sent, delivered, deferred, bounced, complained, and failed;
- duplicate-prevention events;
- scheduler lag and queue latency;
- balance updates within 24 hours of a reminder;
- percentage of users with a fresh balance before a scheduled bill;
- authenticated bill reviews after a reminder;
- emails sent per successful balance update;
- cadence reductions, snoozes, pauses, opt-downs, and opt-outs;
- support incidents involving misunderstood payment certainty;
- template and policy versions.

Do not make email opens the primary success metric. Avoid placing financial or authentication data in analytics properties.

# Experiment and rollout

Place the system behind feature flags or the repository's equivalent rollout mechanism.

Recommended initial experiment:

| Cohort | Days 1-7 | Days 8-30 | Month 2 |
|---|---|---|---|
| Guided | Daily while stale | Three times weekly | Twice weekly |
| Light | Three times weekly | Twice weekly | Weekly |

Keep bill alerts identical across cohorts so the test isolates routine balance cadence. Randomise and report the experiment separately within `FREE_TRIAL` and `DIRECT_PAID`; do not pool the two entry paths because trial expiry and conversion materially change behaviour. Trial lifecycle notices themselves should not vary inside a reminder-cadence experiment unless they are the explicit subject of a separately approved test.

Primary outcome:

- fresh balance before it is operationally needed, especially before scheduled bills.

Secondary outcomes:

- D7 and D30 meaningful product activity, split by entry path;
- trial first-value activation, expiry, and paid conversion outcomes without treating email opens as success;
- direct-paid first-value activation and reminder setup completion;
- messages per successful balance update;
- preference reductions and pauses;
- complaints, bounces, and support contacts.

Proposed kill or rollback criteria:

1. The higher-contact cohort sends more than twice as many messages but improves fresh-balance coverage by less than 10% relative.
2. Opt-downs, pauses, complaints, or support objections are more than twice the Light cohort.
3. Spam complaints trend toward 0.1% or materially exceed the comparison cohort; treat 0.3% as an absolute operational stop.
4. Bill-alert engagement declines as routine message volume rises.
5. Users reasonably infer that ClearTill has executed or guaranteed a payment when it has not.
6. More than 5% of initial recipients immediately reduce reminder frequency; treat this as a product warning signal, not a universal industry benchmark.
7. Most successful balance updates occur without email and the incremental effect is immaterial.

Make thresholds configurable where practical and add an emergency disable switch for routine reminders.

# Tests

Add tests appropriate to the repository. At minimum cover the following.

## Unit tests

- Commercial entry path and reminder mode are stored and evaluated independently.
- Trial welcome is selected only for `FREE_TRIAL`; direct-paid welcome is selected only for `DIRECT_PAID`.
- Auto-renewing and manual-conversion trial copy cannot be interchanged.
- Trial end, first charge, price, interval, and cancellation route come from authoritative billing state.
- Trial setup nudge and paid setup nudge each send at most once and only without first-value activity.
- Early trial conversion cancels ending/expiry emails and emits one conversion confirmation.
- Trial conversion does not send the direct-paid welcome and does not reset Guided cadence age.
- Trial expiry cancels ineligible queued balance and bill reminders and sends at most one expiry notice.
- A direct-paid user never receives trial countdown, expiry, or conversion copy.
- Send-time entitlement revalidation suppresses stale queued lifecycle events.
- Guided cadence at days 1, 7, 8, 30, 31, 60, and 61 for each eligible entry path.
- Daily, weekday, three-per-week, weekly, bills-only, and off modes.
- Stale versus current balance.
- Explicit Daily mode with and without automatic taper.
- Three consecutive no-action reminders causing one-tier backoff.
- Thirty days of inactivity pausing routine balance reminders while leaving enabled bill reminders intact.
- One-bill and multi-bill digest selection.
- Combined bill-and-balance selection instead of two messages.
- Rolling 24-hour routine cap.
- Snooze and quiet-hours behaviour.
- Cancelled, completed, paid, deleted, and rescheduled bills.
- "Scheduled", "expected", and "pending" wording based on source certainty.
- Private-mode redaction in subject, preheader, HTML, and text output.
- Detailed-mode opt-in and ability to revert.
- Stable idempotency key generation.
- Duplicate scheduler and queue attempts.
- Preference audit creation.
- Suppression after hard bounce or complaint.
- Token expiry, one-time use, purpose binding, route allowlisting, and open-redirect prevention.

## Timezone tests

- UTC and Europe/London.
- A positive and negative UTC offset.
- Daylight-saving start and end.
- Month and year boundaries.
- Leap day.
- User timezone change before a queued send.
- "Tomorrow" calculated as a local date rather than 24 elapsed hours.

## Integration tests

- Scheduler to event store to queue.
- Queue retry without duplicate send.
- Template rendering in HTML and plain text.
- Provider adapter with a fake or sandbox provider.
- Signed delivery, bounce, and complaint webhooks.
- Preference change cancelling or suppressing pending events.
- Bill lifecycle change cancelling pending events.
- Feature-flag and emergency-disable behaviour.

## End-to-end tests

Where the repository supports them:

- verified 7-day trial signup -> trial welcome -> setup -> stale balance -> reminder -> authenticated deep link -> balance update;
- trial ending -> early conversion -> pending expiry email cancelled -> one conversion confirmation -> cadence continues without reset;
- trial ending without conversion -> expiry -> ineligible routine reminders cancelled;
- direct-paid signup -> paid welcome -> setup -> stale balance -> reminder, with no trial copy;
- bill due tomorrow -> private digest -> authenticated bill review;
- stale balance plus bill due -> one combined message;
- unsubscribe/pause/snooze -> no later ineligible message;
- complaint/hard bounce -> suppression.

Use deterministic clocks and provider fakes. Do not make tests depend on real time or live email delivery.

# Required deliverables

Implement or update, as applicable:

1. Database migrations and models, including a reliable commercial entry-path/lifecycle projection where the existing billing model does not already provide it.
2. Billing/entitlement event integration and send-time state revalidation.
3. Entry-path-specific trial and direct-paid lifecycle templates and cancellation rules.
4. Preference API and settings UI.
5. Cadence and eligibility policy service.
6. Scheduler/background jobs.
7. Durable event and send records.
8. Idempotent queue publication and consumption.
9. Email-provider adapter and signed webhook handling.
10. Private and Detailed template rendering with plain-text alternatives.
11. Secure task-specific deep links.
12. Suppression and bounce/complaint handling.
13. Feature flags, cohort assignment, and emergency disable control.
14. Product and operational analytics.
15. Unit, integration, and available end-to-end tests.
16. Configuration documentation and sample environment variables without secrets.
17. An operator runbook covering billing-event races, trial conversion/expiry, retries, suppressions, duplicate investigation, provider outage, and rollback.

# Definition of done

The implementation is not complete unless all applicable conditions are met:

- commercial entry path and reminder mode are modelled as separate dimensions;
- 7-day trial users and direct-paid users receive the correct, distinct welcome and setup email sequence;
- trial auto-renewal versus manual-conversion copy is selected from authoritative billing state and cannot fall back to ambiguous wording;
- early conversion, expiry, cancellation, and paid activation cancel stale queued lifecycle messages;
- seamless trial-to-paid conversion preserves reminder preferences and does not restart the seven-day Guided cadence;
- expired trial users do not continue receiving routine reminders without an eligible entitlement;
- users can choose, change, snooze, pause, and disable optional reminders;
- Guided is the default unless existing product policy explicitly overrides it;
- balance reminders send only while the balance is stale;
- next-day bills are grouped;
- bill and balance reminders are merged;
- routine sends are capped at one per rolling 24 hours;
- private mode excludes sensitive financial details from subject, preheader, and body;
- dates and schedules use the user's timezone and handle daylight-saving transitions;
- completed or changed bills invalidate pending reminders;
- durable idempotency prevents duplicates across retries and overlapping jobs;
- hard bounces and complaints suppress further optional email;
- service and marketing logic are separate;
- optional reminder emails expose settings and pause/snooze controls;
- secure links are expiring and single-use when tokens are used;
- GET links do not directly make consequential changes;
- decisions are explainable through stored reason codes and policy versions;
- outcome analytics use ClearTill activity rather than open pixels;
- tests cover policy boundaries, privacy, timezones, concurrency, webhooks, and links;
- migrations are reversible or follow the repository's approved migration policy;
- formatter, linter, type checker, and relevant tests pass;
- rollout and rollback instructions are documented.

# Final implementation report

At completion, report:

- repository architecture and billing/subscription lifecycle discovered;
- whether the trial auto-renews or requires manual conversion, with the authoritative source used;
- entry-path policy decisions and assumptions;
- files and migrations changed;
- configuration and provider setup still required;
- tests and validation commands run, with results;
- security and privacy controls implemented;
- feature flags and rollout procedure;
- known limitations and the cheapest next validation test.

Do not claim production readiness when provider DNS, webhook secrets, legal/privacy approval, migrations, or rollout controls remain incomplete.

# External references to verify before production

Use current versions of authoritative guidance during privacy, security, legal, and deliverability review. These links are context, not a substitute for ClearTill's formal approval process.

- UK ICO, service messages and direct marketing: https://ico.org.uk/for-organisations/advice-for-small-organisations/direct-marketing-and-data-protection/marketing-and-data-protection-in-detail/
- UK ICO, respecting direct-marketing preferences: https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/direct-marketing-guidance/respect-peoples-preferences/
- UK ICO, data protection by design and default: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/data-protection-by-design-and-by-default/
- UK ICO, right to be informed: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-be-informed/
- UK ICO, tracking pixels and electronic mail: https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-direct-marketing-using-electronic-mail/what-else-do-we-need-to-consider/
- OWASP, secure email-token patterns: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
- Google, email sender requirements and spam-rate guidance: https://support.google.com/mail/answer/81126?hl=en
