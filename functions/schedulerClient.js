"use strict";

const SCHEDULER_ENDPOINT = "https://www.cleartill.money/api/scheduler";
const REQUEST_TIMEOUT_MS = 330_000;

async function triggerClearTillScheduler({
  secret,
  fetchImpl = globalThis.fetch,
  endpoint = SCHEDULER_ENDPOINT,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  if (!String(secret || "").trim()) {
    throw new Error("scheduler_secret_missing");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("scheduler_fetch_unavailable");
  }

  const url = new URL(endpoint);
  if (url.href !== SCHEDULER_ENDPOINT) {
    throw new Error("scheduler_endpoint_invalid");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${String(secret).trim()}`,
        accept: "application/json",
        "user-agent": "cleartill-firebase-scheduler/1.0",
      },
      redirect: "error",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`scheduler_http_${response.status}`);
    }

    const summary = await response.json();
    if (summary?.ok !== true) {
      throw new Error("scheduler_response_not_ok");
    }
    return {
      ok: true,
      processedUsers: Number(summary?.processedUsers || 0),
      sent: Number(summary?.sent || 0),
      skipped: Number(summary?.skipped || 0),
      failed: Number(summary?.failed || 0),
      cancelled: Number(summary?.cancelled || 0),
      disabled: Number(summary?.disabled || 0),
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  REQUEST_TIMEOUT_MS,
  SCHEDULER_ENDPOINT,
  triggerClearTillScheduler,
};
