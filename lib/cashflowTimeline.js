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
  const lastIncludedDate = addDays(horizonDate, -1);
  const incomeOccurrences = expandIncomeEvents(
    additionalIncomeEvents,
    addDays(todayIso, 1),
    lastIncludedDate,
  );
  const events = [];

  for (const bill of bills || []) {
    const date = bill?.nextDueDate || bill?.dueDate;
    const amount = Math.max(0, money(bill?.amount));
    if (date && amount > 0 && date >= todayIso && date < horizonDate) {
      events.push({ date, amount: -amount, type: "bill", id: bill.id || null });
    }
  }
  for (const allocation of largeCostAllocations || []) {
    const date = allocation?.nextDueDate || allocation?.date;
    const amount = Math.max(0, money(allocation?.currentAccountAmount ?? allocation?.amount));
    if (date && amount > 0 && date >= todayIso && date < horizonDate) {
      events.push({ date, amount: -amount, type: "large_cost", id: allocation.id || null });
    }
  }
  for (const occurrence of incomeOccurrences) {
    events.push({
      date: occurrence.date,
      amount: occurrence.amount,
      type: "additional_income",
      id: occurrence.occurrenceId,
      name: occurrence.name,
    });
  }

  const { days, safeDailyAmount: rawSafeDailyAmount, minimumProjectedBalance, projectedClosingBalance } = computeSafeDailyRate({
    openingBalance: currentBalance,
    fromIso: todayIso,
    throughIso: horizonDate,
    events,
  });
  const safeDailyAmount = money(Math.max(0, rawSafeDailyAmount));

  // A daily rate times the day count only means something once every day stays
  // non-negative. If the balance is already projected to dip below £0 at some
  // point regardless of further spending, "spending room" must report that
  // actual shortfall — not a £0 floor that reads as "you're fine".
  const spendingRoom = minimumProjectedBalance < 0
    ? money(minimumProjectedBalance)
    : money(safeDailyAmount * days);
  return {
    days,
    safeDailyAmount,
    spendingRoom,
    safeToSpendToday: money(Math.max(0, minimumProjectedBalance)),
    projectedClosingBalance,
    minimumProjectedBalance,
    confirmedAdditionalIncome: money(incomeOccurrences.reduce((total, item) => total + item.amount, 0)),
    incomeOccurrences,
    events: events.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type)),
  };
}

export { money as roundCashflowMoney };
