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
    && String(event?.status || "scheduled") === "scheduled"
    && String(event?.confidence || "confirmed") === "confirmed"
    && money(event?.amount) > 0
    && Boolean(event?.expectedDate);
}

export function expandIncomeEvents(events = [], fromIso, throughIso, { confirmedOnly = true } = {}) {
  if (!fromIso || !throughIso || throughIso < fromIso) return [];
  const occurrences = [];

  for (const event of events || []) {
    if (event?.active === false || String(event?.status || "scheduled") !== "scheduled") continue;
    if (confirmedOnly && String(event?.confidence || "confirmed") !== "confirmed") continue;
    const amount = money(event?.amount);
    const firstDate = String(event?.expectedDate || "");
    if (amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(firstDate)) continue;

    const frequency = ["weekly", "fortnightly", "monthly"].includes(event.frequency)
      ? event.frequency
      : "one_off";
    const preferredDay = toUtcDate(firstDate).getUTCDate();
    let occurrenceDate = firstDate;
    let occurrenceIndex = 0;

    while (occurrenceDate <= throughIso) {
      if (occurrenceDate >= fromIso) {
        occurrences.push({
          eventId: event.id || null,
          occurrenceId: `${event.id || "income"}-${occurrenceDate}`,
          name: String(event.name || "Other income").trim() || "Other income",
          amount,
          date: occurrenceDate,
          frequency,
          confidence: String(event.confidence || "confirmed"),
        });
      }

      if (frequency === "one_off") break;
      occurrenceIndex += 1;
      if (occurrenceIndex > 120) break;
      if (frequency === "weekly") occurrenceDate = addDays(occurrenceDate, 7);
      else if (frequency === "fortnightly") occurrenceDate = addDays(occurrenceDate, 14);
      else occurrenceDate = addMonths(firstDate, occurrenceIndex, preferredDay);
    }
  }

  return occurrences.sort((a, b) => a.date.localeCompare(b.date) || String(a.eventId).localeCompare(String(b.eventId)));
}

export function calculateSafeSpendingPlan({
  todayIso,
  horizonDate,
  currentBalance = 0,
  bills = [],
  largeCostAllocations = [],
  additionalIncomeEvents = [],
} = {}) {
  const days = Math.max(1, daysBetween(todayIso, horizonDate));
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

  events.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));
  let projectedBalance = money(currentBalance);
  let minimumProjectedBalance = projectedBalance;
  let safeDailyAmount = Number.POSITIVE_INFINITY;
  let eventIndex = 0;

  while (eventIndex < events.length && events[eventIndex].date <= todayIso) {
    projectedBalance = money(projectedBalance + events[eventIndex].amount);
    minimumProjectedBalance = Math.min(minimumProjectedBalance, projectedBalance);
    eventIndex += 1;
  }

  for (let elapsedDays = 1; elapsedDays <= days; elapsedDays += 1) {
    const date = addDays(todayIso, elapsedDays);
    while (eventIndex < events.length && events[eventIndex].date <= date) {
      projectedBalance = money(projectedBalance + events[eventIndex].amount);
      minimumProjectedBalance = Math.min(minimumProjectedBalance, projectedBalance);
      eventIndex += 1;
    }
    safeDailyAmount = Math.min(safeDailyAmount, projectedBalance / elapsedDays);
  }

  safeDailyAmount = money(Math.max(0, Number.isFinite(safeDailyAmount) ? safeDailyAmount : 0));
  return {
    days,
    safeDailyAmount,
    spendingRoom: money(safeDailyAmount * days),
    safeToSpendToday: money(Math.max(0, minimumProjectedBalance)),
    projectedClosingBalance: projectedBalance,
    minimumProjectedBalance: money(minimumProjectedBalance),
    confirmedAdditionalIncome: money(incomeOccurrences.reduce((total, item) => total + item.amount, 0)),
    incomeOccurrences,
    events,
  };
}

export { money as roundCashflowMoney };
