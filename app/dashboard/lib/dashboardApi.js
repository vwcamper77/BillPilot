import { auth } from "@/lib/firebase";
import { buildBillDocument } from "@/lib/billMath";
import { safeError } from "@/lib/security/safeLog";
import { dedupeBillItems } from "./billHelpers";

const IMAGE_IMPORT_FETCH_TIMEOUT_MS = 70000;

export async function postDashboardRequest(route, action, payload = {}, options = {}) {
  const { unauthenticatedMessage, fallbackError } = options;
  const currentUser = auth?.currentUser;
  const uid = currentUser?.uid || null;

  console.log("[dashboard-save] request", {
    action,
    uid,
    route,
    tokenAcquired: false,
  });

  if (!currentUser) {
    throw new Error(unauthenticatedMessage || "Please sign in again before saving.");
  }

  let idToken;

  try {
    idToken = await currentUser.getIdToken();
    console.log("[dashboard-save] token", {
      action,
      uid,
      route,
      tokenAcquired: Boolean(idToken),
    });
  } catch (error) {
    console.error("[dashboard-save] token-error", {
      action,
      uid,
      route,
      tokenAcquired: false,
      error: error?.message || String(error),
    });
    throw error;
  }

  const response = await fetch(route, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      action,
      ...payload,
    }),
  });
  const responsePayload = await response.json().catch(() => ({}));

  console.log("[dashboard-save] response", {
    action,
    uid,
    route,
    status: response.status,
    response: responsePayload,
  });

  if (!response.ok || !responsePayload?.ok) {
    throw new Error(responsePayload?.error || fallbackError || "Could not save that change.");
  }

  return responsePayload;
}

export async function postDashboardSettingsAction(action, payload = {}) {
  return postDashboardRequest("/api/dashboard/settings", action, payload, {
    unauthenticatedMessage: "Please sign in again before saving that setting.",
    fallbackError: "Could not save that setting.",
  });
}

export async function postDashboardStateAction() {
  return postDashboardRequest("/api/dashboard/state", "load_state", {}, {
    unauthenticatedMessage: "Please sign in again before loading your dashboard.",
    fallbackError: "Could not load your dashboard.",
  });
}

export async function postDashboardForecastAction(payload = {}) {
  return postDashboardRequest("/api/dashboard/forecast", "save_forecast", payload, {
    unauthenticatedMessage: "Please sign in again before saving your forecast settings.",
    fallbackError: "Could not save your forecast settings.",
  });
}

export async function postDashboardLargeCostAction(action, payload = {}) {
  return postDashboardRequest("/api/dashboard/large-costs", action, payload, {
    unauthenticatedMessage: "Please sign in again before saving that large cost.",
    fallbackError: "Could not save that large cost.",
  });
}

export async function postDashboardIncomeEventAction(action, payload = {}) {
  return postDashboardRequest("/api/dashboard/income-events", action, payload, {
    unauthenticatedMessage: "Please sign in again before saving that income.",
    fallbackError: "Could not save that income.",
  });
}

export async function postDashboardBillAction(action, payload = {}) {
  return postDashboardRequest("/api/dashboard/bills", action, payload, {
    unauthenticatedMessage: "Please sign in again before saving that bill.",
    fallbackError: "Could not save that bill.",
  });
}

export async function saveIncome(parsed, hasExistingIncome) {
  await postDashboardForecastAction({
    amount: parsed.amount,
    payDay: parsed.payDay,
    hasExistingIncome,
  });
}

export async function applyParsedActions(parsed, hasExistingIncome, existingBills = []) {
  const outcome = { createdBills: 0, skippedBills: 0, savedIncome: false, savedBills: [] };
  const items = parsed.action === "batch" ? parsed.items || [] : [parsed];
  const billItems = dedupeBillItems(
    items.filter((item) => item.action === "create_bill"),
    existingBills,
  );
  const incomeItems = items.filter((item) => item.action === "set_income");

  outcome.skippedBills = billItems.skipped;

  if (billItems.toCreate.length) {
    const saveResults = await Promise.allSettled(
      billItems.toCreate.map(async (item) => {
        const bill = buildBillDocument(item);
        const payload = {
          ...bill,
          category: item.category || null,
        };
        const result = await postDashboardBillAction("create_bill", { fields: payload });
        return {
          id: result.billId,
          ...payload,
        };
      }),
    );
    outcome.createdBills = saveResults.filter((r) => r.status === "fulfilled").length;
    outcome.savedBills = saveResults
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    const failures = saveResults.filter((r) => r.status === "rejected");
    if (failures.length) {
      safeError("[applyParsedActions] some bill saves failed", { count: failures.length });
      if (!outcome.createdBills) {
        throw failures[0].reason || new Error("Could not save that bill.");
      }
    }
  }

  if (incomeItems.length) {
    try {
      await saveIncome(incomeItems[incomeItems.length - 1], hasExistingIncome);
      outcome.savedIncome = true;
    } catch (saveError) {
      safeError("[applyParsedActions] income save failed", { code: saveError?.code });
    }
  }

  return outcome;
}

export async function withTimeout(promise, ms, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchImageImport(formData, jobName) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(`Image import timed out for ${jobName}`), IMAGE_IMPORT_FETCH_TIMEOUT_MS)
    : null;

  try {
    return await fetch("/api/parse", {
      method: "POST",
      body: formData,
      signal: controller?.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${jobName} timed out after ${IMAGE_IMPORT_FETCH_TIMEOUT_MS}ms`);
    }

    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function runWithTimeout(promise, timeoutMessage, timeoutMs = 12000) {
  let timeoutId;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}
