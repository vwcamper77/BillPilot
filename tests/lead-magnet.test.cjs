const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("lead magnet route composes validation, IP extraction and rate-limited fulfilment", () => {
  const route = read("app/api/lead-magnet/route.js");
  const server = read("lib/leadMagnet.server.js");
  assert.match(route, /getRequestIp\(request\)/);
  assert.match(server, /lead-magnet-ip/);
  assert.match(server, /lead-magnet-email/);
  assert.match(server, /claimEmailDelivery/);
  assert.match(server, /marketingConsent && !suppression\.exists/);
  assert.match(server, /consentTextVersion/);
});

test("lead capture uses auth, route, session, dismissal, completion and accessible dialog guards", () => {
  const component = read("components/LeadMagnetCapture.jsx");
  for (const required of ["onAuthStateChanged", "shownThisSession", "dismissedAt", "completed", "primaryCtaUsed", 'role="dialog"', 'aria-modal="true"', 'event.key === "Escape"', 'event.key !== "Tab"']) {
    assert.ok(component.includes(required), `missing ${required}`);
  }
  assert.match(component, /relatedTarget === null && event\.clientY <= 0/);
  assert.match(component, /mobileTimeReady.*mobileScrolled/);
});

test("analytics allowlist contains every lead magnet event and client payload excludes email", () => {
  const constants = read("lib/analytics/constants.js");
  const component = read("components/LeadMagnetCapture.jsx");
  for (const event of ["popup_eligible", "popup_viewed", "popup_dismissed", "form_started", "submitted", "marketing_opt_in", "pdf_downloaded", "sheet_downloaded", "google_copy_clicked", "to_preview_clicked", "preview_started"]) {
    assert.match(constants, new RegExp(`lead_magnet_${event}`));
  }
  assert.doesNotMatch(component, /trackEvent\([^\n]+email/);
});

test("public worksheet and guide assets exist and are non-empty", () => {
  const xlsx = fs.statSync(path.join(root, "public/downloads/cleartill-free-cash-position-sheet.xlsx"));
  const pdf = fs.statSync(path.join(root, "public/guides/cleartill-bank-balance-reset-guide.pdf"));
  assert.ok(xlsx.size > 10_000);
  assert.ok(pdf.size > 100_000);
});
