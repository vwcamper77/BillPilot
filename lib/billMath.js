export const UK_TIME_ZONE = "Europe/London";
const DEFAULT_REMINDER_OFFSET_DAYS = 1;
export const LARGE_COST_PERIOD_DAYS = {
  one_off: null,
  every_2_months: 61,
  quarterly: 91,
  every_6_months: 183,
  yearly: 365,
};

const LARGE_COST_MONTH_STEPS = {
  every_2_months: 2,
  quarterly: 3,
  every_6_months: 6,
  yearly: 12,
};

export function getTodayIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

export function formatGBP(amount) {
  const value = Number(amount) || 0;

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

export function formatCurrency(amount, currency = "GBP") {
  const value = Number(amount) || 0;

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency || "GBP",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

export function formatOrdinal(day) {
  const value = Number(day);
  if (!isValidDueDay(value)) {
    return "date not set";
  }
  const suffix =
    value % 100 >= 11 && value % 100 <= 13
      ? "th"
      : { 1: "st", 2: "nd", 3: "rd" }[value % 10] || "th";

  return `${value}${suffix}`;
}

export function formatDisplayDate(isoDate) {
  if (!isoDate) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(toUtcDate(isoDate));
}

export function normaliseEntityName(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  const minorWords = new Set(["and", "of", "the", "for", "to", "in", "on"]);

  if (!text) {
    return "";
  }

  return text
    .split(" ")
    .map((word, index) => {
      if (word.length <= 1) {
        return word.toUpperCase();
      }

      if (word === word.toUpperCase() && /[A-Z]/.test(word)) {
        return word;
      }

      if (index > 0 && minorWords.has(word.toLowerCase())) {
        return word.toLowerCase();
      }

      return `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`;
    })
    .join(" ");
}

export function normaliseBillName(name) {
  if (!name) {
    return "";
  }

  const originalName = String(name)
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, "-");
  const cleanedName = normaliseEntityName(
    originalName
      .replace(/^(?:my|our|the)\s+/i, "")
      .replace(/\b(?:direct debit|standing order|bank transfer|scheduled payment|payment to|paid to|payment for|bill for)\b/gi, " ")
      .replace(/\b(?:amount|payment|bill|transaction|recurring|monthly payment)\b/gi, " ")
      .replace(/(?:£|\bgbp\b|\bpounds?\b)\s*\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?/gi, " ")
      .replace(/\b\d{1,5}(?:\.\d{1,2})?\b/g, " ")
      .replace(/\b([12]?\d|3[01])(st|nd|rd|th)\b/gi, " ")
      .replace(/\b(due on|due|on the|on)\b.*$/i, "")
      .replace(/\b(and there(?:'|’)s|there(?:'|’)s|there is|around|about|approximately|approx|roughly)\b.*$/i, "")
      .replace(/\b(of every month|of each month|every month|each month|per month|every|each|monthly|month)\b/gi, " ")
      .replace(/\b(my|our|the|for|from|to|via|by)\b/gi, " ")
      .replace(/\b(of|and|for|to|from)\b$/gi, "")
      .replace(/^[\s\-â€“â€”:;,.|/]+|[\s\-â€“â€”:;,.|/]+$/g, "")
      .replace(/[^\p{L}\p{N}&'+\-/.\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );

  return cleanedName;
}

export function formatDueLabel(isoDate, todayIso = getTodayIso()) {
  const days = diffDays(todayIso, isoDate);

  if (days === 0) {
    return "today";
  }

  if (days === 1) {
    return "tomorrow";
  }

  return formatDisplayDate(isoDate);
}

export function calculateBillSchedule(
  dueDay,
  reminderOffsetDays = DEFAULT_REMINDER_OFFSET_DAYS,
  paidThroughDate = null,
  todayIso = getTodayIso(),
) {
  if (!isValidDueDay(dueDay)) {
    return {
      nextDueDate: null,
      reminderDate: null,
    };
  }

  let nextDueDate = getNextMonthlyDate(dueDay, todayIso);

  while (isValidIsoDate(paidThroughDate) && paidThroughDate >= nextDueDate) {
    nextDueDate = addMonthsIso(nextDueDate, 1);
  }

  const reminderDate = addDaysIso(nextDueDate, -normaliseReminderOffset(reminderOffsetDays));

  return {
    nextDueDate,
    reminderDate,
  };
}

export function getNextDueDateFromDay(dueDay, today = new Date()) {
  if (!isValidDueDay(dueDay)) {
    return null;
  }

  const current = startOfToday(today);
  const year = current.getFullYear();
  const month = current.getMonth();
  let candidate = new Date(year, month, Number(dueDay), 12);

  if (candidate < current) {
    candidate = new Date(year, month + 1, Number(dueDay), 12);
  }

  return candidate;
}

export function calculateIncomeSchedule(payDay, todayIso = getTodayIso()) {
  if (!isValidDueDay(payDay)) {
    return {
      nextPayDate: null,
    };
  }

  return {
    nextPayDate: getNextMonthlyDate(payDay, todayIso),
  };
}

export function buildBillDocument(parsed, todayIso = getTodayIso()) {
  const reminderOffsetDays = normaliseReminderOffset(parsed.reminderOffsetDays);
  const safeDueDay = isValidDueDay(parsed.dueDay) ? Number(parsed.dueDay) : null;
  const schedule = calculateBillSchedule(safeDueDay, reminderOffsetDays, parsed.paidThroughDate || null, todayIso);

  return {
    type: "bill",
    name: normaliseBillName(parsed.name),
    amount: Number(parsed.amount),
    currency: parsed.currency || "GBP",
    frequency: "monthly",
    dueDay: safeDueDay,
    reminderOffsetDays,
    reminderDate: schedule.reminderDate,
    nextDueDate: schedule.nextDueDate,
    paidThroughDate: parsed.paidThroughDate || null,
    active: true,
    lastReminderSentAt: null,
    lastPaidAt: null,
  };
}

export function buildIncomeDocument(parsed) {
  const amount = Number(parsed.amount);
  const payDay = isValidDueDay(parsed.payDay) ? Number(parsed.payDay) : null;

  return {
    type: "income",
    name: normaliseEntityName(parsed.name || "Payday"),
    amount: Number.isFinite(amount) && amount >= 0 ? amount : null,
    currency: parsed.currency || "GBP",
    frequency: "monthly",
    payDay,
    active: true,
  };
}

export function buildLargeCostDocument(parsed, todayIso = getTodayIso()) {
  const dueDate = isValidIsoDate(parsed?.dueDate) ? parsed.dueDate : todayIso;
  const frequency = normaliseLargeCostFrequency(parsed?.frequency);
  const amount = Number(parsed?.amount);
  const amountAlreadySaved = normaliseSavedAmount(parsed?.amountAlreadySaved, amount);

  return {
    type: "large_cost",
    name: normaliseEntityName(parsed?.name || ""),
    amount,
    amountAlreadySaved,
    currency: parsed?.currency || "GBP",
    dueDate,
    frequency,
    category: parsed?.category || "other",
    fundingStatus: normaliseLargeCostFundingStatus(parsed?.fundingStatus),
    active: true,
  };
}

export function normaliseLargeCostFundingStatus(value) {
  const fundingStatus = String(value || "").trim().toLowerCase();
  if ([
    "current_account",
    "savings",
    "split",
    "unassigned",
  ].includes(fundingStatus)) {
    return fundingStatus;
  }
  return "unassigned";
}

export function projectLargeCost(cost, todayIso = getTodayIso()) {
  if (!cost || Number(cost.amount) <= 0 || !isValidIsoDate(cost.dueDate)) {
    return null;
  }

  const amount = Number(cost.amount);
  const amountAlreadySaved = normaliseSavedAmount(cost.amountAlreadySaved, amount);
  const fundingStatus = normaliseLargeCostFundingStatus(cost.fundingStatus);
  const savingsCoveredAmount = fundingStatus === "split"
    ? Math.min(amount, amountAlreadySaved)
    : fundingStatus === "savings"
      ? amount
      : 0;
  const currentAccountAmount = fundingStatus === "current_account"
    ? amount
    : fundingStatus === "split"
      ? Math.max(0, amount - amountAlreadySaved)
      : 0;
  const unassignedAmount = fundingStatus === "unassigned" ? amount : 0;
  const frequency = normaliseLargeCostFrequency(cost.frequency);
  const dueDate = cost.dueDate;
  const monthlyMultiplier = 30.44;

  if (frequency === "one_off") {
    const daysUntilDue = ceilDiffDays(todayIso, dueDate);
    const perDayRaw = daysUntilDue <= 0 ? currentAccountAmount : currentAccountAmount / Math.max(1, daysUntilDue);
    const status = daysUntilDue < 0 ? "overdue" : daysUntilDue === 0 ? "due_now" : "";

    return {
      ...cost,
      amount,
      amountAlreadySaved,
      fundingStatus,
      amountRemaining: currentAccountAmount,
      currentAccountAmount,
      savingsCoveredAmount,
      unassignedAmount,
      frequency,
      dueDate,
      nextDueDate: dueDate,
      daysUntilDue,
      perDayRaw,
      monthlySavingRaw: perDayRaw * monthlyMultiplier,
      perDayRounded: Math.max(0, Math.round(perDayRaw)),
      status,
      dueLabel: formatLargeCostDueLabel(daysUntilDue),
    };
  }

  const nextDueDate = rollLargeCostDueDateForward(dueDate, frequency, todayIso);
  const daysUntilDue = ceilDiffDays(todayIso, nextDueDate);
  const perDayRaw = daysUntilDue <= 0 ? currentAccountAmount : currentAccountAmount / Math.max(1, daysUntilDue);

  return {
    ...cost,
    amount,
    amountAlreadySaved,
    fundingStatus,
    amountRemaining: currentAccountAmount,
    currentAccountAmount,
    savingsCoveredAmount,
    unassignedAmount,
    frequency,
    dueDate,
    nextDueDate,
    daysUntilDue,
    perDayRaw,
    monthlySavingRaw: perDayRaw * monthlyMultiplier,
    perDayRounded: Math.max(0, Math.round(perDayRaw)),
    status: "",
    dueLabel: formatLargeCostDueLabel(daysUntilDue),
  };
}

export function largeCostDailyReserve(costs = [], todayIso = getTodayIso()) {
  return costs.reduce((total, cost) => {
    if (cost?.active === false) {
      return total;
    }

    const projected = projectLargeCost(cost, todayIso);
    return total + (projected?.perDayRaw || 0);
  }, 0);
}

export function calculateLargeCostFunding(costs = [], generalSavings = 0, todayIso = getTodayIso()) {
  const projectedCosts = costs
    .filter((cost) => cost?.active !== false)
    .map((cost) => projectLargeCost(cost, todayIso))
    .filter(Boolean);

  const totalBigCosts = projectedCosts.reduce((total, cost) => total + (Number(cost.amount) || 0), 0);
  const totalCostSpecificSaved = projectedCosts.reduce((total, cost) => (
    total + (Number(cost.amountAlreadySaved) || 0)
  ), 0);
  const totalSavingsSetAside = Math.max(0, Number(generalSavings) || 0);
  const totalCurrentAccountPortion = projectedCosts.reduce((total, cost) => total + (Number(cost.currentAccountAmount) || 0), 0);
  const totalSavingsFunded = projectedCosts.reduce((total, cost) => total + (Number(cost.savingsCoveredAmount) || 0), 0);
  const totalUnassigned = projectedCosts.reduce((total, cost) => total + (Number(cost.unassignedAmount) || 0), 0);

  const adjustedCosts = projectedCosts.map((cost) => {
    const adjustedPerDayRaw = cost.daysUntilDue <= 0
      ? (Number(cost.currentAccountAmount) || 0)
      : (Number(cost.currentAccountAmount) || 0) / Math.max(1, cost.daysUntilDue);
    const adjustedMonthlySavingRaw = adjustedPerDayRaw * 30.44;

    return {
      ...cost,
      generalSavingsShare: 0,
      remainingAfterSavings: Number(cost.currentAccountAmount) || 0,
      adjustedPerDayRaw,
      adjustedMonthlySavingRaw,
      adjustedPerDayRounded: Math.max(0, Math.round(adjustedPerDayRaw)),
    };
  });

  const requiredDailyAfterSavings = adjustedCosts.reduce((total, cost) => total + (cost.adjustedPerDayRaw || 0), 0);
  const requiredMonthlyAfterSavings = adjustedCosts.reduce((total, cost) => total + (cost.adjustedMonthlySavingRaw || 0), 0);

  return {
    costs: adjustedCosts,
    totalBigCosts,
    generalProtectedSavings: totalSavingsSetAside,
    totalCostSpecificSaved,
    totalProtectedSavings: totalSavingsSetAside + totalCostSpecificSaved,
    totalSavingsSetAside,
    generalSavingsApplied: 0,
    bigCostsRemainingBeforeProtectedSavings: totalCurrentAccountPortion,
    totalRemainingBeforeSavings: totalCurrentAccountPortion,
    bigCostsStillToFund: totalCurrentAccountPortion,
    totalRemainingAfterSavings: totalCurrentAccountPortion,
    bigCostsHittingCurrentAccount: totalCurrentAccountPortion,
    bigCostsCoveredBySavings: totalSavingsFunded,
    unassignedBigCosts: totalUnassigned,
    requiredDailyAfterSavings,
    requiredMonthlyAfterSavings,
  };
}

export function calculateLargeCostImpact(costs = [], generalSavings = 0, baseDailyBudget = 0, daysTillPayday = 0, todayIso = getTodayIso()) {
  const funding = calculateLargeCostFunding(costs, generalSavings, todayIso);
  const normalDailyBudgetBeforeBigCosts = Math.max(0, Number(baseDailyBudget) || 0);
  const bigCostDailyNeedBeforeSavings = largeCostDailyReserve(costs, todayIso);
  const protectedSavingsForBigCosts = funding.generalSavingsApplied;
  const bigCostsStillToFund = funding.totalRemainingAfterSavings;
  const bigCostDailyNeedAfterSavings = funding.requiredDailyAfterSavings;
  const safeDailyBudgetAfterBigCosts = Math.max(0, normalDailyBudgetBeforeBigCosts - bigCostDailyNeedAfterSavings);
  const bigCostDailyShortfall = Math.max(0, bigCostDailyNeedAfterSavings - normalDailyBudgetBeforeBigCosts);
  const runwayDays = Math.max(0, Number(daysTillPayday) || 0);

  return {
    ...funding,
    normalDailyBudgetBeforeBigCosts,
    bigCostDailyNeedBeforeSavings,
    protectedSavingsForBigCosts,
    bigCostsStillToFund,
    bigCostDailyNeedAfterSavings,
    safeDailyBudgetAfterBigCosts,
    bigCostDailyShortfall,
    fundingNeededUntilPayday: bigCostDailyShortfall * runwayDays,
    normalDailyBudget: normalDailyBudgetBeforeBigCosts,
    bigCostDailyNeed: bigCostDailyNeedAfterSavings,
    safeDailyBudget: safeDailyBudgetAfterBigCosts,
    dailyShortfall: bigCostDailyShortfall,
  };
}

export function calculateDashboard(
  bills = [],
  income = null,
  account = null,
  todayIso = getTodayIso(),
  currency = "GBP",
) {
  const activeBills = bills
    .filter((bill) => bill.active !== false)
    .map((bill) => {
      const nextDueDateObject = getNextDueDateFromDay(bill.dueDay);
      const schedule = calculateBillSchedule(
        bill.dueDay,
        bill.reminderOffsetDays || DEFAULT_REMINDER_OFFSET_DAYS,
        bill.paidThroughDate || null,
        todayIso,
      );

      return {
        ...bill,
        ...schedule,
        nextDueDateObject: schedule.nextDueDate ? toUtcDate(schedule.nextDueDate) : nextDueDateObject,
        amount: Number(bill.amount) || 0,
      };
    })
    .sort(compareBillsByNextDueDate);

  const paydayDate = income?.active !== false && isValidDueDay(income?.payDay)
    ? calculateIncomeSchedule(income.payDay, todayIso).nextPayDate
    : null;

  const beforePayday = paydayDate
    ? activeBills.filter((bill) => bill.nextDueDate && bill.nextDueDate < paydayDate)
    : [];
  const afterPayday = paydayDate
    ? activeBills.filter((bill) => !bill.nextDueDate || bill.nextDueDate >= paydayDate)
    : activeBills;
  const upcomingBills = activeBills.filter((bill) => bill.nextDueDate).slice(0, 7);
  const fallbackUpcomingBills = upcomingBills.length ? upcomingBills : activeBills.slice(0, 7);
  const nextBill = activeBills.find((bill) => bill.nextDueDate) || activeBills[0] || null;
  const totalBeforePayday = sumAmounts(beforePayday);
  const totalMonthlyBills = sumAmounts(activeBills);
  const currentBalance = Number(account?.currentBalance) || 0;
  const leftBeforePayday = currentBalance - totalBeforePayday;
  const leftAfterMonthlyBills = currentBalance - totalMonthlyBills;
  const allRunwayBills = paydayDate ? beforePayday : fallbackUpcomingBills;
  const runwayBills = allRunwayBills.slice(0, 5);
  const runwayMoreCount = Math.max(0, allRunwayBills.length - 5);
  const incomeAmount =
    Number.isFinite(Number(income?.amount)) && Number(income?.amount) > 0
      ? Number(income.amount)
      : null;
  const monthlySpendingRoom = incomeAmount !== null ? incomeAmount - totalMonthlyBills : null;
  const dailySpendingRoom = monthlySpendingRoom !== null ? (monthlySpendingRoom * 12) / 365 : null;
  const daysTillPayday = paydayDate ? Math.max(1, diffDays(todayIso, paydayDate)) : null;
  const dailyLimitTillPayday = daysTillPayday !== null ? leftBeforePayday / daysTillPayday : null;

  return {
    beforePayday,
    afterPayday,
    upcomingBills: fallbackUpcomingBills,
    nextBill,
    paydayDate,
    currentBalance,
    totalBeforePayday,
    totalMonthlyBills,
    leftBeforePayday,
    leftAfterMonthlyBills,
    monthlySpendingRoom,
    dailySpendingRoom,
    daysTillPayday,
    dailyLimitTillPayday,
    runwayMoreCount,
    runwayTitle: paydayDate ? "Runway to payday" : "Next bills",
    runwayEvents: buildRunwayEvents(runwayBills, paydayDate, todayIso, currency),
  };
}

export function buildReminderMessage(targetBill, allBills = [], income = null, todayIso = getTodayIso()) {
  const targetSchedule = calculateBillSchedule(
    targetBill.dueDay,
    targetBill.reminderOffsetDays || DEFAULT_REMINDER_OFFSET_DAYS,
    targetBill.paidThroughDate || null,
    todayIso,
  );
  const dueLabel = targetSchedule.nextDueDate
    ? formatDueLabel(targetSchedule.nextDueDate, todayIso)
    : "on a date not set";
  const base = `${targetBill.name} is due ${dueLabel} — ${formatGBP(targetBill.amount)}.`;

  if (!isValidDueDay(income?.payDay)) {
    return base;
  }

  const paydayDate = calculateIncomeSchedule(income.payDay, todayIso).nextPayDate;
  const remainingBills = allBills
    .filter((bill) => bill.active !== false && bill.id !== targetBill.id)
    .map((bill) => ({
      ...bill,
      ...calculateBillSchedule(
        bill.dueDay,
        bill.reminderOffsetDays || DEFAULT_REMINDER_OFFSET_DAYS,
        bill.paidThroughDate || null,
        todayIso,
      ),
    }))
    .filter(
      (bill) =>
        bill.nextDueDate &&
        targetSchedule.nextDueDate &&
        bill.nextDueDate >= targetSchedule.nextDueDate &&
        bill.nextDueDate < paydayDate,
    );
  const remainingTotal = sumAmounts(remainingBills);

  if (remainingTotal > 0) {
    return `${base} You still have ${formatGBP(remainingTotal)} due before payday.`;
  }

  return `${base} After this, you’re clear until payday.`;
}

export function getReminderDocumentId(billId, reminderDate) {
  return `${billId}_${reminderDate}`;
}

function buildRunwayEvents(bills, paydayDate, todayIso, currency = "GBP") {
  const events = [{ label: "Today", detail: formatDisplayDate(todayIso), type: "today" }];

  bills.forEach((bill) => {
    events.push({
      label: bill.name,
      detail: bill.nextDueDate
        ? `${formatCurrency(bill.amount, currency)} due ${formatDueLabel(bill.nextDueDate, todayIso)}`
        : `${formatCurrency(bill.amount, currency)} due date not set`,
      type: "bill",
    });
  });

  if (paydayDate) {
    events.push({
      label: "Payday",
      detail: formatDisplayDate(paydayDate),
      type: "payday",
    });
  }

  return events;
}

export function isValidDueDay(day) {
  return Number.isInteger(Number(day)) && Number(day) >= 1 && Number(day) <= 31;
}

function compareBillsByNextDueDate(a, b) {
  if (a.nextDueDateObject && b.nextDueDateObject) {
    return a.nextDueDateObject - b.nextDueDateObject;
  }

  if (a.nextDueDateObject) {
    return -1;
  }

  if (b.nextDueDateObject) {
    return 1;
  }

  return String(a.name || "").localeCompare(String(b.name || ""));
}

function sumAmounts(items) {
  return items.reduce((total, item) => total + (Number(item.amount) || 0), 0);
}

function formatLargeCostDueLabel(daysUntilDue) {
  if (daysUntilDue < 0) {
    return `overdue by ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) === 1 ? "" : "s"}`;
  }

  if (daysUntilDue === 0) {
    return "due now";
  }

  if (daysUntilDue === 1) {
    return "due tomorrow";
  }

  return `due in ${daysUntilDue} days`;
}

function getNextMonthlyDate(day, todayIso) {
  const today = toUtcDate(todayIso);
  const targetDay = clampDay(day);
  const thisMonth = isoForMonthDay(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    targetDay,
  );

  if (thisMonth >= todayIso) {
    return thisMonth;
  }

  const nextMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1, 12));

  return isoForMonthDay(
    nextMonth.getUTCFullYear(),
    nextMonth.getUTCMonth(),
    targetDay,
  );
}

function isoForMonthDay(year, monthIndex, day) {
  const safeDay = Math.min(clampDay(day), daysInMonth(year, monthIndex));
  return dateToIso(new Date(Date.UTC(year, monthIndex, safeDay, 12)));
}

function normaliseReminderOffset(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_REMINDER_OFFSET_DAYS;
}

function normaliseLargeCostFrequency(value) {
  if (value === "one_off") return "one_off";
  if (value === "every_2_months") return "every_2_months";
  if (value === "quarterly") return "quarterly";
  if (value === "every_6_months") return "every_6_months";
  if (value === "yearly") return "yearly";
  return "one_off";
}

function normaliseSavedAmount(value, totalAmount) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  const safeTotal = Number.isFinite(Number(totalAmount)) ? Number(totalAmount) : parsed;
  return Math.min(parsed, Math.max(0, safeTotal));
}

function clampDay(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.min(Math.max(Math.round(parsed), 1), 31);
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addDaysIso(isoDate, days) {
  const date = toUtcDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return dateToIso(date);
}

function addMonthsIso(isoDate, months) {
  const date = toUtcDate(isoDate);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(year, month + months, 1, 12));
  return isoForMonthDay(target.getUTCFullYear(), target.getUTCMonth(), day);
}

export function diffDays(startIso, endIso) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((toUtcDate(endIso) - toUtcDate(startIso)) / msPerDay);
}

function ceilDiffDays(startIso, endIso) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((toUtcDate(endIso) - toUtcDate(startIso)) / msPerDay);
}

function toUtcDate(isoDate) {
  return new Date(`${isoDate}T12:00:00.000Z`);
}

function isValidIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function rollLargeCostDueDateForward(dueDate, frequency, todayIso) {
  const monthStep = LARGE_COST_MONTH_STEPS[frequency];

  if (!monthStep) {
    return dueDate;
  }

  let nextDueDate = dueDate;

  while (nextDueDate < todayIso) {
    nextDueDate = addMonthsIso(nextDueDate, monthStep);
  }

  return nextDueDate;
}

function startOfToday(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function dateToIso(date) {
  return date.toISOString().slice(0, 10);
}
