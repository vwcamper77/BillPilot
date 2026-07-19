# ClearTill lead magnet and exit-intent implementation

## Verdict: PROCEED

The lead magnet is close enough to ClearTill's core problem to attract relevant prospects, but it must not become a complete free replacement for the product. Keep the spreadsheet limited to one payday cycle and position ClearTill as the mechanism that keeps the calculation current.

## Canonical hosting structure

Use an owned landing page as the permanent URL:

- Landing page: `https://www.cleartill.money/free-cash-position-sheet`
- Excel file: `public/downloads/cleartill-free-cash-position-sheet.xlsx`
- PDF guide: `public/guides/cleartill-bank-balance-reset-guide.pdf`

The PDF already links to the proposed landing page. That route must be deployed before the guide is promoted.

The landing page should offer:

1. **Download Excel version**
2. **Make a Google Sheets copy**
3. **Try ClearTill free for seven days**

For Google Sheets, upload the workbook to Google Drive, convert it to a native Google Sheet and share the master as Viewer. Use a forced-copy URL ending in `/copy`, and place that URL behind the landing-page button. Do not expose the editable master.

## Exit-intent popup copy

**Eyebrow**

Free 10-minute cash check

**Headline**

Before you go, work out what your balance still has to cover.

**Body**

Get the ClearTill Bank Balance Reset guide and free cash-position spreadsheet. Use it to see what is genuinely left before payday.

**Benefit chips**

- Excel and Google Sheets
- No bank connection
- One-payday calculation
- Immediate access

**Field**

Email address

**Primary CTA**

Send the free guide

**Fulfilment copy**

We will email the guide and spreadsheet link requested. No card and no bank login.

**Separate optional marketing consent**

Email me occasional ClearTill money-planning tips and product updates. I can unsubscribe at any time. This is optional.

The marketing box must be unticked by default. The visitor must receive the requested guide regardless of whether they opt into marketing.

## Trigger and suppression rules

Show only when all conditions are true:

- User is logged out.
- User has been on the page for at least 20 seconds.
- Desktop pointer exits through the top of the viewport.
- Visitor has not started sign-up, clicked the main CTA or entered an email elsewhere.
- Popup has not been dismissed or completed during the suppression period.

Suppression:

- After dismissal: suppress for 14 days.
- After successful submission: suppress permanently in local storage and server-side where identifiable.
- Never show on sign-in, sign-up, account, dashboard, checkout, billing-success, legal or admin routes.
- Show at most once per browser session.

Mobile does not have reliable exit intent. Use a separate, less intrusive mobile rule:

- At least 45 seconds on page;
- at least 60% scroll depth;
- no main CTA interaction;
- display as a bottom sheet, not a full-screen interruption.

## Submission flow

1. Validate and normalise the email server-side.
2. Rate-limit by IP and email hash.
3. Store only the data needed for fulfilment, consent evidence and attribution.
4. Send one transactional delivery email containing links to the guide and landing page.
5. Only add the address to marketing sequences when the separate checkbox is checked.
6. Record consent text version, timestamp, source page and campaign parameters.
7. Provide unsubscribe handling and maintain a suppression list.
8. Redirect or reveal an immediate download panel after successful submission so delivery does not depend solely on email.

## Recommended analytics events

- `lead_magnet_popup_eligible`
- `lead_magnet_popup_viewed`
- `lead_magnet_popup_dismissed`
- `lead_magnet_form_started`
- `lead_magnet_submitted`
- `lead_magnet_marketing_opt_in`
- `lead_magnet_pdf_downloaded`
- `lead_magnet_sheet_downloaded`
- `lead_magnet_google_copy_clicked`
- `lead_magnet_to_preview_clicked`
- `lead_magnet_preview_started`

Attach route, referrer, UTM values, device class and experiment variant. Do not send the email address to analytics platforms.

## Minimum viable experiment

Run a 50/50 test for logged-out homepage visitors:

- Control: no exit popup.
- Variant: exit popup described above.

Primary metric: completed first ClearTill position per eligible visitor.

Secondary metrics: valid lead rate, guide downloads, preview starts, popup dismissal rate and unsubscribe/complaint rate.

Do not optimise for email submissions alone. A high lead count with no first-position conversion is low-value demand.

## Kill criteria

Pause or revise the popup if any of the following occurs after a reasonable sample:

- Main homepage CTA conversion falls by more than 10% relative.
- More than 70% of popup viewers dismiss without engaging.
- Fewer than 5% of captured leads start a ClearTill preview within 14 days.
- Spam complaints, consent disputes or unsubscribe rates are materially above the rest of the email programme.
- The spreadsheet becomes the final destination rather than an acquisition path into ClearTill.
