"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  SCHEDULER_ENDPOINT,
  triggerClearTillScheduler,
} = require("../schedulerClient");

test("calls the fixed ClearTill scheduler endpoint with bearer authentication", async () => {
  let request;
  const summary = await triggerClearTillScheduler({
    secret: "test-secret",
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, processedUsers: 3, sent: 1, skipped: 2 }),
      };
    },
  });

  assert.equal(request.url, SCHEDULER_ENDPOINT);
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.authorization, "Bearer test-secret");
  assert.equal(request.options.redirect, "error");
  assert.deepEqual(summary, {
    ok: true,
    processedUsers: 3,
    sent: 1,
    skipped: 2,
    failed: 0,
    cancelled: 0,
    disabled: 0,
  });
});

test("rejects a missing secret before making a request", async () => {
  let called = false;
  await assert.rejects(
    triggerClearTillScheduler({ secret: "", fetchImpl: async () => { called = true; } }),
    /scheduler_secret_missing/,
  );
  assert.equal(called, false);
});

test("rejects endpoints outside the fixed HTTPS scheduler route", async () => {
  await assert.rejects(
    triggerClearTillScheduler({
      secret: "test-secret",
      endpoint: "https://example.com/api/scheduler",
      fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true }) }),
    }),
    /scheduler_endpoint_invalid/,
  );
});

test("reports only an HTTP status for failed responses", async () => {
  await assert.rejects(
    triggerClearTillScheduler({
      secret: "test-secret",
      fetchImpl: async () => ({ ok: false, status: 503 }),
    }),
    /^Error: scheduler_http_503$/,
  );
});

test("retries when the scheduler returns an unsuccessful summary", async () => {
  await assert.rejects(
    triggerClearTillScheduler({
      secret: "test-secret",
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: false }) }),
    }),
    /^Error: scheduler_response_not_ok$/,
  );
});
