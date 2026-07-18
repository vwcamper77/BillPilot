const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

test("email operations API is admin-only, no-store and privacy minimised", () => {
  const route = read("app/api/admin/email-operations/route.js");
  assert.match(route, /verifyAnalyticsAdminRequest/);
  assert.match(route, /private, no-store/);
  assert.match(route, /maskOperationalEmail/);
  assert.doesNotMatch(route, /html:|text:|billName|balanceAmount|rawToken/);
});

test("admin board distinguishes delivery from reading and exposes operational health", () => {
  const page = read("app/admin/email-operations/page.jsx");
  assert.match(page, /Delivered is not read/);
  assert.match(page, /Activity after send/);
  assert.match(page, /Provider/);
  assert.match(page, /Webhook/);
  assert.doesNotMatch(page, /readAt|openedAt|open rate/i);
});
