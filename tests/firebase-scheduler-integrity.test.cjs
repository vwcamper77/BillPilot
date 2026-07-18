const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Firebase owns the hourly reminder scheduler and Vercel does not", () => {
  const firebase = JSON.parse(read("firebase.json"));
  const vercel = JSON.parse(read("vercel.json"));
  const functionSource = read("functions/index.js");

  assert.equal(firebase.functions.source, "functions");
  assert.equal(firebase.functions.runtime, "nodejs22");
  assert.match(functionSource, /schedule: "0 \* \* \* \*"/);
  assert.match(functionSource, /defineSecret\("CLEARTILL_SCHEDULER_SECRET"\)/);
  assert.equal(vercel.crons.some((cron) => cron.path === "/api/scheduler"), false);
});

test("Firebase scheduler proxy is pinned to the canonical HTTPS endpoint", () => {
  const clientSource = read("functions/schedulerClient.js");
  assert.match(clientSource, /https:\/\/www\.cleartill\.money\/api\/scheduler/);
  assert.match(clientSource, /authorization: `Bearer \$\{/);
  assert.match(clientSource, /redirect: "error"/);
});
