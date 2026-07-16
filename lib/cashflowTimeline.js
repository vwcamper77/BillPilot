const DAY_MS = 86400000;

function money(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function toUtcDate(isoDate) {
  return new Date(`${isoDate}T12:00:00.000Z`);
}

function toIso(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const date = toUtcDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

function addMonths(isoDate, months, preferredDay = null) {
  const date = toUtcDate(isoDate);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = preferredDay || date.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0, 12)).getUTCDate();
  return toIso(new Date(Date.UTC(year, month, Math.min(day, lastDay), 12)));
}

function daysBetween(startIso, endIso) {
  return Math.max(0, Math.round((toUtcDate(endIso) - toUtcDate(startIso)) / DAY_MS));
}

export function isConfirmedIncomeEvent(event) {
  return event?.active !== false
    && String(event?.status || "scheduled") !== "cancelled"
    && String(event?.confidence || "confirmed") === "confirmed"
    && money(event?.amount) > 0
    && Boolean(event?.firstPaymentDate || event?.expectedDate);
}

export function expandIncomeEvents(events = [], fromIso, throughIso, { confirmedOnly = true, includeNonForecast = false, asOfIso = fromIso } = {}) {
  if (!fromIso || !throughIso || throughIso < fromIso) return [];
  const occurrences = [];

  for (const event of events || []) {
    if (event?.active === false || String(event?.status || "scheduled") === "cancelled") continue;
    if (confirmedOnly && String(event?.confidence || "confirmed") !== "confirmed") continue;
    const amount = money(event?.amount);
    const firstDate = String(event?.firstPaymentDate || event?.expectedDate || "");
    if (amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(firstDate)) continue;

    const frequency = ["weekly", "fortnightly", "four_weekly", "monthly"].includes(event.frequency)
      ? event.frequency
      : "one_off";
    const endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(event?.endDate || "")) ? String(event.endDate) : null;
    const preferredDay = toUtcDate(firstDate).getUTCDate();
    let occurrenceDate = firstDate;
    let occurrenceIndex = 0;

    while (occurrenceDate <= throughIso && (!endDate || occurrenceDate <= endDate)) {
      if (occurrenceDate >= fromIso) {
        const explicitStatus = event?.occurrenceStatuses?.[occurrenceDate];
        const status = explicitStatus || (occurrenceDate < asOfIso ? "overdue_unconfirmed" : "scheduled");
        if (includeNonForecast || status === "scheduled") occurrences.push({
          eventId: event.id || null,
          occurrenceId: `${event.id || "income"}-${occurrenceDate}`,
          name: String(event.name || "Other income").trim() || "Other income",
          amount,
          date: occurrenceDate,
          frequency,
          confidence: String(event.confidence || "confirmed"),
          status,
        });
      }

      if (frequency === "one_off") break;
      occurrenceIndex += 1;
      if (occurrenceIndex > 120) break;
      if (frequency === "weekly") occurrenceDate = addDays(occurrenceDate, 7);
      else if (frequency === "fortnightly") occurrenceDate = addDays(occurrenceDate, 14);
      else if (frequency === "four_weekly") occurrenceDate = addDays(occurrenceDate, 28);
      else occurrenceDate = addMonths(firstDate, occurrenceIndex, preferredDay);
    }
  }

  return occurrences.sort((a, b) => a.date.localeCompare(b.date) || String(a.eventId).localeCompare(String(b.eventId)));
}

function expandMonthlyDate(firstDate, index) {
  return addMonths(firstDate, index, toUtcDate(firstDate).getUTCDate());
}

function expandDatedOutflows(items, todayIso, horizonDate, type) {
  const occurrences = [];
  const monthSteps = { monthly: 1, every_2_months: 2, quarterly: 3, every_6_months: 6, yearly: 12 };

  for (const [sourceIndex, item] of (items || []).entries()) {
    if (item?.active === false) continue;
    const amount = Math.max(0, money(item?.currentAccountAmount ?? item?.amount));
    const firstDate = String(item?.nextDueDate || item?.dueDate || item?.date || "");
    if (!amount || !/^\d{4}-\d{2}-\d{2}$/.test(firstDate)) continue;
    const monthStep = type === "bill"
      ? (item.frequency === "one_off" ? 0 : 1)
      : (monthSteps[item.frequency] || 0);
    let date = firstDate;
    let occurrenceIndex = 0;

    while (date <= horizonDate) {
      if (date >= todayIso) {
        occurrences.push({
          id: item.id || `${type}-${sourceIndex}`,
          occurrenceId: `${item.id || `${type}-${sourceIndex}`}-${date}`,
          name: item.name || (type === "bill" ? "Bill" : "Large-cost funding"),
          date,
          amount: -amount,
          type,
          rank: 0,
        });
      }
      if (!monthStep) break;
      occurrenceIndex += 1;
      if (occurrenceIndex > 24) break;
      date = expandMonthlyDate(firstDate, occurrenceIndex * monthStep);
    }
  }

  return occurrences;
}

/**
 * Canonical dated cash position. All consumers should use these separate
 * fields instead of treating a future closing balance as money available now.
 * Same-day outflows are deliberately applied before income (rank 0 then 1).
 */
export function calculateCashPosition({
  todayIso,
  horizonDate,
  currentBalance = 0,
  bills = [],
  largeCostAllocations = [],
  additionalIncomeEvents = [],
  paydayDate = null,
  incomeAmount = 0,
} = {}) {
  if (!todayIso || !horizonDate || horizonDate < todayIso) {
    throw new Error("todayIso and a horizonDate on or after today are required.");
  }

  const availableNow = money(currentBalance);
  const events = [
    ...expandDatedOutflows(bills, todayIso, horizonDate, "bill"),
    ...expandDatedOutflows(largeCostAllocations, todayIso, horizonDate, "large_cost"),
  ];

  for (const occurrence of expandIncomeEvents(additionalIncomeEvents, todayIso, horizonDate)) {
    events.push({
      id: occurrence.eventId,
      occurrenceId: occurrence.occurrenceId,
      name: occurrence.name,
      date: occurrence.date,
      amount: money(occurrence.amount),
      type: "additional_income",
      rank: 1,
      frequency: occurrence.frequency,
    });
  }

  const safeIncomeAmount = Math.max(0, money(incomeAmount));
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(paydayDate || "")) && safeIncomeAmount > 0) {
    let date = paydayDate;
    let index = 0;
    while (date <= horizonDate) {
      if (date >= todayIso) {
        events.push({ id: "primary-pay", occurrenceId: `primary-pay-${date}`, name: "Pay", date, amount: safeIncomeAmount, type: "primary_pay", rank: 1, frequency: "monthly" });
      }
      index += 1;
      if (index > 24) break;
      date = expandMonthlyDate(paydayDate, index);
    }
  }

  const uniqueEvents = [...new Map(events.map((event) => [`${event.type}:${event.occurrenceId}`, event])).values()]
    .sort((a, b) => a.date.localeCompare(b.date) || a.rank - b.rank || String(a.occurrenceId).localeCompare(String(b.occurrenceId)));
  let runningBalance = availableNow;
  let lowestProjectedBalance = availableNow;
  let firstNegativeDate = availableNow < 0 ? todayIso : null;
  const ledger = uniqueEvents.map((event) => {
    runningBalance = money(runningBalance + event.amount);
    lowestProjectedBalance = Math.min(lowestProjectedBalance, runningBalance);
    if (!firstNegativeDate && runningBalance < 0) firstNegativeDate = event.date;
    return { ...event, balanceAfter: runningBalance };
  });

  const incomeEvents = ledger.filter((event) => event.amount > 0);
  const outflowEvents = ledger.filter((event) => event.amount < 0);
  const nextConfirmedIncome = incomeEvents[0] || null;
  const preIncomeBoundary = nextConfirmedIncome?.date || horizonDate;
  const outflowsBeforeNextIncome = outflowEvents.filter((event) => event.date <= preIncomeBoundary);
  const billsBeforeNextIncome = outflowsBeforeNextIncome.filter((event) => event.type === "bill");
  const protectedBeforeNextIncome = outflowsBeforeNextIncome.filter((event) => event.type === "large_cost");
  const outflowBeforeNextIncomeTotal = money(outflowsBeforeNextIncome.reduce((total, event) => total + Math.abs(event.amount), 0));
  const safeUntilNextIncome = money(availableNow - outflowBeforeNextIncomeTotal);
  const daysUntilNextIncome = Math.max(1, daysBetween(todayIso, preIncomeBoundary));
  const safePerDayUntilNextIncome = safeUntilNextIncome > 0 ? money(safeUntilNextIncome / daysUntilNextIncome) : 0;
  const confirmedIncomeThroughHorizon = money(incomeEvents.reduce((total, event) => total + event.amount, 0));
  const outflowsThroughHorizon = money(outflowEvents.reduce((total, event) => total + Math.abs(event.amount), 0));
  const billOutflowsThroughHorizon = money(outflowEvents.filter((event) => event.type === "bill").reduce((total, event) => total + Math.abs(event.amount), 0));
  const protectedOutflowsThroughHorizon = money(outflowEvents.filter((event) => event.type === "large_cost").reduce((total, event) => total + Math.abs(event.amount), 0));
  const forecastAtHorizon = money(availableNow + confirmedIncomeThroughHorizon - outflowsThroughHorizon);
  const datesWithIncome = new Set(incomeEvents.map((event) => event.date));
  const sameDayDependencies = [...new Set(outflowEvents.filter((event) => datesWithIncome.has(event.date)).map((event) => event.date))];

  return {
    todayIso,
    horizonDate,
    availableNow,
    nextConfirmedIncome,
    billsBeforeNextIncome,
    protectedBeforeNextIncome,
    outflowsBeforeNextIncome,
    billsBeforeNextIncomeTotal: money(billsBeforeNextIncome.reduce((total, event) => total + Math.abs(event.amount), 0)),
    protectedBeforeNextIncomeTotal: money(protectedBeforeNextIncome.reduce((total, event) => total + Math.abs(event.amount), 0)),
    outflowBeforeNextIncomeTotal,
    safeUntilNextIncome,
    daysUntilNextIncome,
    safePerDayUntilNextIncome,
    confirmedIncomeThroughHorizon,
    outflowsThroughHorizon,
    billOutflowsThroughHorizon,
    protectedOutflowsThroughHorizon,
    forecastAtHorizon,
    lowestProjectedBalance: money(lowestProjectedBalance),
    firstNegativeDate,
    sameDayDependencies,
    incomeEvents,
    outflowEvents,
    events: ledger,
  };
}

/**
 * The core "how much can I safely spend per day" scan: walk forward one day
 * at a time from fromIso, applying every dated event (income positive, bills
 * and large costs negative) exactly once as its date is reached, and track
 * the worst-case balance-per-elapsed-day ratio. That minimum is the one daily
 * rate that never lets the balance dip below what it's already going to dip
 * to — spending less never helps a day that's already the floor, spending
 * more on any other day is what the rate is meant to cap.
 *
 * `events` need not be pre-sorted or pre-filtered to the window; only events
 * with date <= throughIso are considered, and anything dated on/before
 * fromIso is applied immediately (day zero) rather than counted against the
 * rate — the caller's openingBalance is assumed to already reflect "now".
 */
export function computeSafeDailyRate({ openingBalance = 0, fromIso, throughIso, events = [] } = {}) {
  const days = Math.max(1, daysBetween(fromIso, throughIso));
  const sortedEvents = [...(events || [])]
    .filter((event) => event?.date && event.date <= throughIso)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.rank ?? 1) - (b.rank ?? 1) || String(a.type).localeCompare(String(b.type)));

  let projectedBalance = money(openingBalance);
  let minimumProjectedBalance = projectedBalance;
  let safeDailyAmount = Number.POSITIVE_INFINITY;
  let eventIndex = 0;

  while (eventIndex < sortedEvents.length && sortedEvents[eventIndex].date <= fromIso) {
    projectedBalance = money(projectedBalance + sortedEvents[eventIndex].amount);
    minimumProjectedBalance = Math.min(minimumProjectedBalance, projectedBalance);
    eventIndex += 1;
  }

  for (let elapsedDays = 1; elapsedDays <= days; elapsedDays += 1) {
    const date = addDays(fromIso, elapsedDays);
    while (eventIndex < sortedEvents.length && sortedEvents[eventIndex].date <= date) {
      projectedBalance = money(projectedBalance + sortedEvents[eventIndex].amount);
      minimumProjectedBalance = Math.min(minimumProjectedBalance, projectedBalance);
      eventIndex += 1;
    }
    safeDailyAmount = Math.min(safeDailyAmount, projectedBalance / elapsedDays);
  }

  // Not clamped to £0 here: a genuine shortfall needs to stay negative so a
  // caller computing "available to spend" for the affected stretch reports
  // the real amount short, rather than a floor that reads as "you're fine".
  // calculateSafeSpendingPlan (below) clamps its own public safeDailyAmount
  // for display; buildWeeklySafeSpendingPlan (billMath.js) uses the raw value.
  return {
    days,
    // Preserve the unrounded rate for callers that multiply it back across
    // several days. Rounding 63p / 6 to 11p too early would incorrectly turn
    // 63p of safe cash into a 66p weekly allowance.
    rawSafeDailyAmount: Number.isFinite(safeDailyAmount) ? safeDailyAmount : 0,
    safeDailyAmount: money(Number.isFinite(safeDailyAmount) ? safeDailyAmount : 0),
    minimumProjectedBalance: money(minimumProjectedBalance),
    projectedClosingBalance: projectedBalance,
  };
}

export function calculateSafeSpendingPlan({
  todayIso,
  horizonDate,
  currentBalance = 0,
  bills = [],
  largeCostAllocations = [],
  additionalIncomeEvents = [],
} = {}) {
  // This legacy-shaped adapter now delegates to the canonical ledger. The
  // horizon itself remains excluded here for compatibility with "until"
  // callers; the canonical position API is inclusive by design.
  const lastIncludedDate = addDays(horizonDate, -1);
  const position = calculateCashPosition({
    todayIso,
    horizonDate: lastIncludedDate < todayIso ? todayIso : lastIncludedDate,
    currentBalance,
    bills,
    largeCostAllocations,
    additionalIncomeEvents,
  });
  const days = position.nextConfirmedIncome
    ? position.daysUntilNextIncome
    : Math.max(1, daysBetween(todayIso, horizonDate));
  const safeDailyAmount = position.safeUntilNextIncome > 0 ? money(position.safeUntilNextIncome / days) : 0;
  return {
    days,
    safeDailyAmount,
    spendingRoom: position.safeUntilNextIncome,
    availableBeforeHorizon: position.forecastAtHorizon,
    dailyAvailableAmount: safeDailyAmount,
    safeToSpendToday: Math.max(0, position.safeUntilNextIncome),
    projectedClosingBalance: position.forecastAtHorizon,
    minimumProjectedBalance: position.lowestProjectedBalance,
    confirmedAdditionalIncome: position.confirmedIncomeThroughHorizon,
    incomeOccurrences: position.incomeEvents,
    events: position.events,
    canonicalPosition: position,
  };
}
export { money as roundCashflowMoney };
