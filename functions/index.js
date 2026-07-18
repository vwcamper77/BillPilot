"use strict";

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { triggerClearTillScheduler } = require("./schedulerClient");

const schedulerSecret = defineSecret("CLEARTILL_SCHEDULER_SECRET");

exports.runClearTillReminderScheduler = onSchedule(
  {
    schedule: "0 * * * *",
    timeZone: "Etc/UTC",
    region: "europe-west2",
    memory: "256MiB",
    timeoutSeconds: 360,
    maxInstances: 1,
    concurrency: 1,
    retryCount: 2,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 300,
    maxRetrySeconds: 900,
    secrets: [schedulerSecret],
  },
  async () => {
    const summary = await triggerClearTillScheduler({ secret: schedulerSecret.value() });
    logger.info("ClearTill reminder scheduler completed", summary);
  },
);
