import { expandIncomeEvents } from "./cashflowTimeline.js";

const MONEY_SCALE = 100;

function money(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * MONEY_SCALE) / MONEY_SCALE : 0;
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
  return Math.max(0, Math.round((toUtcDate(endIso) - toUtcDate(startIso)) / 86400000));
}

function formatShortDate(isoDate) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(toUtcDate(isoDate));
}

function formatMoney(value, { alwaysPence = false } = {}) {
  const amount = money(value);
  return `£${amount.toLocaleString("en-GB", {
    minimumFractionDigits: alwaysPence || !Number.isInteger(amount) ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

function normaliseFundingStatus(cost) {
  const value = String(cost?.fundingStatus || cost?.fundingSource || "unassigned").toLowerCase();
  return ["current_account", "savings", "split", "unassigned"].includes(value) ? value : "unassigned";
}

export function resolveLargeCostContributions(cost = {}) {
  const amount = Math.max(0, money(cost.amount));
  const fundingStatus = normaliseFundingStatus(cost);
  const hasExplicitCurrent = Number.isFinite(Number(cost.currentBalanceContribution));
  const hasExplicitSavings = Number.isFinite(Number(cost.savingsContribution));
  const legacySavings = Math.min(amount, Math.max(0, money(cost.amountAlreadySaved)));

  let savingsContribution = 0;
  let currentBalanceContribution = 0;

  if (fundingStatus === "savings") {
    savingsContribution = hasExplicitSavings ? money(cost.savingsContribution) : amount;
  } else if (fundingStatus === "current_account") {
    currentBalanceContribution = hasExplicitCurrent ? money(cost.currentBalanceContribution) : amount;
  } else if (fundingStatus === "split") {
    savingsContribution = hasExplicitSavings ? money(cost.savingsContribution) : legacySavings;
    currentBalanceContribution = hasExplicitCurrent
      ? money(cost.currentBalanceContribution)
      : money(amount - savingsContribution);
  } else {
    // Legacy unassigned records remain calculable and are treated conservatively:
    // anything not already saved still has to come from the current account.
    savingsContribution = hasExplicitSavings ? money(cost.savingsContribution) : legacySavings;
    currentBalanceContribution = hasExplicitCurrent
      ? money(cost.currentBalanceContribution)
      : money(amount - savingsContribution);
  }

  savingsContribution = Math.min(amount, Math.max(0, money(savingsContribution)));
  currentBalanceContribution = Math.min(
    Math.max(0, money(amount - savingsContribution)),
    Math.max(0, money(currentBalanceContribution)),
  );
  const allocated = money(savingsContribution + currentBalanceContribution);

  return {
    amount,
    fundingStatus,
    savingsContribution,
    currentBalanceContribution,
    allocationGap: Math.max(0, money(amount - allocated)),
  };
}

function buildPayPeriods({ todayIso, paydayDate, throughDate, currentBalance, incomeAmount }) {
  const safeThroughDate = throughDate >= todayIso ? throughDate : todayIso;
  const periods = [];

  if (!paydayDate || paydayDate <= todayIso) {
    periods.push({
      index: 0,
      start: todayIso,
      end: safeThroughDate,
      payDate: null,
      nextPayDate: null,
      openingAvailableBalance: money(currentBalance),
      expectedIncome: 0,
      days: Math.max(1, daysBetween(todayIso, addDays(safeThroughDate, 1))),
      label: `By ${formatShortDate(safeThroughDate)}`,
    });
    return periods;
  }

  const payDay = toUtcDate(paydayDate).getUTCDate();
  periods.push({
    index: 0,
    start: todayIso,
    end: addDays(paydayDate, -1),
    payDate: paydayDate,
    nextPayDate: paydayDate,
    openingAvailableBalance: money(currentBalance),
    expectedIncome: 0,
    days: Math.max(1, daysBetween(todayIso, paydayDate)),
    label: `Before ${formatShortDate(paydayDate)}`,
  });

  let periodStart = paydayDate;
  let index = 1;
  while (periodStart <= safeThroughDate) {
    const nextPayDate = addMonths(periodStart, 1, payDay);
    const periodEnd = addDays(nextPayDate, -1);
    periods.push({
      index,
      start: periodStart,
      end: periodEnd,
      payDate: periodStart,
      nextPayDate,
      openingAvailableBalance: 0,
      expectedIncome: money(incomeAmount),
      days: Math.max(1, daysBetween(periodStart, nextPayDate)),
      label: `${formatShortDate(periodStart)}–${formatShortDate(periodEnd)}`,
    });
    periodStart = nextPayDate;
    index += 1;
  }

  return periods;
}

function splitPeriodsAtAdditionalIncome(periods, additionalIncomeEvents, todayIso) {
  const horizon = periods[periods.length - 1]?.end || todayIso;
  const occurrences = expandIncomeEvents(additionalIncomeEvents, addDays(todayIso, 1), horizon);
  if (!occurrences.length) {
    return periods.map((period, index) => ({
      ...period,
      index,
      basePeriodIndex: period.index,
      sourceType: period.index === 0 ? "current_balance" : "primary_pay",
      sourceLabel: period.index === 0 ? "Current balance" : "Pay",
    }));
  }

  const segments = [];
  for (const basePeriod of periods) {
    const inPeriod = occurrences.filter((item) => item.date >= basePeriod.start && item.date <= basePeriod.end);
    const grouped = new Map();
    for (const occurrence of inPeriod) {
      const current = grouped.get(occurrence.date) || [];
      current.push(occurrence);
      grouped.set(occurrence.date, current);
    }
    const boundaries = [...new Set([basePeriod.start, ...grouped.keys()])].sort();
    boundaries.forEach((start, boundaryIndex) => {
      const nextStart = boundaries[boundaryIndex + 1] || addDays(basePeriod.end, 1);
      const additional = grouped.get(start) || [];
      const primaryIncome = boundaryIndex === 0 ? basePeriod.expectedIncome : 0;
      const additionalAmount = money(additional.reduce((total, item) => total + item.amount, 0));
      const additionalNames = [...new Set(additional.map((item) => item.name))];
      const isCurrent = basePeriod.index === 0 && boundaryIndex === 0;
      const hasPrimaryPay = primaryIncome > 0;
      const sourceType = isCurrent ? "current_balance" : hasPrimaryPay ? "primary_pay" : "additional_income";
      const sourceLabel = sourceType === "current_balance"
        ? "Current balance"
        : sourceType === "primary_pay"
          ? "Pay"
          : additionalNames.length === 1 ? additionalNames[0] : "Other income";

      segments.push({
        ...basePeriod,
        index: segments.length,
        basePeriodIndex: basePeriod.index,
        start,
        end: addDays(nextStart, -1),
        periodStart: start,
        openingAvailableBalance: boundaryIndex === 0 ? basePeriod.openingAvailableBalance : 0,
        expectedIncome: money(primaryIncome + additionalAmount),
        primaryIncome: money(primaryIncome),
        additionalIncome: additionalAmount,
        incomeOccurrences: additional,
        payDate: isCurrent ? basePeriod.payDate : start,
        days: Math.max(1, daysBetween(start, nextStart)),
        label: isCurrent ? basePeriod.label : `${formatShortDate(start)}–${formatShortDate(addDays(nextStart, -1))}`,
        sourceType,
        sourceLabel,
      });
    });
  }
  return segments;
}

function billOccurrenceDates(bill, todayIso, throughDate) {
  if (bill?.active === false || money(bill?.amount) <= 0) return [];
  const firstDue = bill.nextDueDate || bill.dueDate;
  const dueDay = Number(bill.dueDay);

  if (firstDue) {
    const dates = [];
    let date = firstDue;
    const preferredDay = Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31
      ? dueDay
      : toUtcDate(firstDue).getUTCDate();
    while (date <= throughDate) {
      if (date >= todayIso) dates.push(date);
      if (bill.frequency && bill.frequency !== "monthly") break;
      date = addMonths(date, 1, preferredDay);
    }
    return dates;
  }

  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return [];
  const dates = [];
  let monthCursor = todayIso.slice(0, 8) + "01";
  while (monthCursor <= throughDate) {
    const candidate = addMonths(monthCursor, 0, dueDay);
    if (candidate >= todayIso && candidate <= throughDate) dates.push(candidate);
    monthCursor = addMonths(monthCursor, 1, 1);
  }
  return dates;
}

function addBillsToPeriods(periods, bills, todayIso, throughDate) {
  for (const period of periods) {
    period.normalBills = 0;
    period.billOccurrences = [];
  }

  for (const bill of bills || []) {
    for (const dueDate of billOccurrenceDates(bill, todayIso, throughDate)) {
      const period = periods.find((candidate) => dueDate >= candidate.start && dueDate <= candidate.end);
      if (!period) continue;
      const amount = money(bill.amount);
      period.normalBills = money(period.normalBills + amount);
      period.billOccurrences.push({ id: bill.id || null, name: bill.name || "Bill", dueDate, amount });
    }
  }

  for (const period of periods) {
    period.availableCommitmentCapacity = Math.max(0, money(
      period.openingAvailableBalance + period.expectedIncome - period.normalBills,
    ));
    period.committedLargeCosts = 0;
  }
}

function statePriority(state) {
  return {
    unaffordable_by_due_date: 4,
    wait_until_payday: 3,
    affordable_by_due_date: 2,
    affordable_now: 1,
  }[state] || 0;
}

function buildDeterministicExplanation(plan) {
  const amount = formatMoney(plan.totalCost);
  const due = formatShortDate(plan.dueDate);
  const shortfall = formatMoney(plan.shortfall);
  const current = plan.periods[0];
  const afterDaily = formatMoney(current.safeDailyAfter, { alwaysPence: true });
  const futureClauses = plan.periods
    .filter((period) => period.index > 0 && period.protectedAmount > 0)
    .map((period) => period.sourceType === "additional_income"
      ? `${formatMoney(period.protectedAmount)} from ${period.sourceLabel} on ${formatShortDate(period.payDate)}`
      : `${formatMoney(period.protectedAmount)} from your pay on ${formatShortDate(period.payDate)}`);
  const savingsClause = plan.savingsContribution > 0
    ? `${formatMoney(plan.savingsContribution)} from savings`
    : "";

  if (plan.state === "unaffordable_by_due_date") {
    return `This is not affordable by ${due}. You are short by ${shortfall}.`;
  }
  if (plan.state === "wait_until_payday") {
    const funding = [...futureClauses, savingsClause].filter(Boolean).join(" and ");
    return `Wait until payday. You do not need to take money from your current balance yet. Fund ${funding}.`;
  }
  if (plan.state === "affordable_by_due_date") {
    const funding = [...futureClauses, savingsClause].filter(Boolean).join(" and ");
    return `You can afford this by ${due}. Protect ${formatMoney(plan.currentPeriodAllocation)} before payday and use ${funding}. This leaves approximately ${afterDaily} per day until payday.`;
  }
  if (plan.savingsContribution >= plan.totalCost) {
    return `You can afford this now. The full ${amount} is covered from savings, so it does not reduce your current daily spending amount.`;
  }
  const savingsText = savingsClause ? ` and use ${savingsClause}` : "";
  return `You can afford this now. Protect ${formatMoney(plan.currentPeriodAllocation)} before payday${savingsText}. This leaves approximately ${afterDaily} per day until payday.`;
}

export function calculateLargeCostAffordabilityPlans({
  todayIso,
  paydayDate = null,
  currentBalance = 0,
  incomeAmount = 0,
  additionalIncomeEvents = [],
  bills = [],
  largeCosts = [],
  savingsAvailable = 0,
} = {}) {
  if (!todayIso) throw new Error("todayIso is required for Large Cost planning.");

  const costs = (largeCosts || [])
    .filter((cost) => cost?.active !== false && money(cost?.amount) > 0 && (cost?.nextDueDate || cost?.dueDate))
    .map((cost, sourceIndex) => {
      const contributions = resolveLargeCostContributions(cost);
      return {
        ...cost,
        ...contributions,
        sourceIndex,
        dueDate: cost.nextDueDate || cost.dueDate,
        id: cost.id || `large-cost-${sourceIndex}`,
      };
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || String(a.id).localeCompare(String(b.id)));

  const throughDate = costs.reduce((latest, cost) => cost.dueDate > latest ? cost.dueDate : latest, todayIso);
  const basePeriods = buildPayPeriods({ todayIso, paydayDate, throughDate, currentBalance, incomeAmount });
  const periods = splitPeriodsAtAdditionalIncome(basePeriods, additionalIncomeEvents, todayIso);
  // A due-date decision must not spend money needed later in the same pay
  // cycle. Reserve normal bills through the end of the last eligible period.
  const cashflowHorizon = periods[periods.length - 1]?.end || throughDate;
  addBillsToPeriods(periods, bills, todayIso, cashflowHorizon);

  const allocationsByCost = new Map();
  for (const cost of costs) {
    let remaining = money(cost.currentBalanceContribution);
    const allocations = periods.map(() => 0);

    // Fund as late as safely possible. This preserves today's cash flow and
    // only pulls money into the current period when later pay periods cannot
    // cover the contribution by the actual due date.
    const eligiblePeriods = periods.filter((period) => period.start <= cost.dueDate).reverse();
    for (const period of eligiblePeriods) {
      if (remaining <= 0) break;
      const remainingCapacity = Math.max(0, money(period.availableCommitmentCapacity - period.committedLargeCosts));
      const allocation = Math.min(remaining, remainingCapacity);
      allocations[period.index] = money(allocation);
      period.committedLargeCosts = money(period.committedLargeCosts + allocation);
      remaining = money(remaining - allocation);
    }

    allocationsByCost.set(cost.id, { allocations, currentShortfall: Math.max(0, remaining) });
  }

  const plans = costs.map((cost) => {
    const allocationResult = allocationsByCost.get(cost.id);
    const effectiveDueDate = cost.dueDate < todayIso ? todayIso : cost.dueDate;
    const planPeriods = periods
      .filter((period) => period.start <= effectiveDueDate)
      .map((period) => {
        const protectedAmount = allocationResult.allocations[period.index] || 0;
        const otherCommittedLargeCosts = money(period.committedLargeCosts - protectedAmount);
        const resultingSafeSpendingRoom = Math.max(0, money(
          period.openingAvailableBalance
          + period.expectedIncome
          - period.normalBills
          - otherCommittedLargeCosts
          - protectedAmount,
        ));
        const safeBefore = Math.max(0, money(
          period.openingAvailableBalance + period.expectedIncome - period.normalBills - otherCommittedLargeCosts,
        ));

        return {
          index: period.index,
          label: period.label,
          periodStart: period.start,
          periodEnd: period.end,
          payDate: period.payDate,
          sourceType: period.sourceType,
          sourceLabel: period.sourceLabel,
          openingAvailableBalance: period.openingAvailableBalance,
          expectedIncome: period.expectedIncome,
          normalBills: period.normalBills,
          otherCommittedLargeCosts,
          protectedAmount,
          resultingSafeSpendingRoom,
          days: period.days,
          safeDailyBefore: money(safeBefore / period.days),
          safeDailyAfter: money(resultingSafeSpendingRoom / period.days),
        };
      });

    const shortfall = money(allocationResult.currentShortfall + cost.allocationGap);
    const fundedPeriods = planPeriods.filter((period) => period.protectedAmount > 0);
    const currentAllocation = planPeriods[0]?.protectedAmount || 0;
    const futureAllocation = money(fundedPeriods
      .filter((period) => period.index > 0)
      .reduce((total, period) => total + period.protectedAmount, 0));
    const firstFutureFunded = fundedPeriods.find((period) => period.index > 0);
    let state = "affordable_now";
    if (shortfall > 0) state = "unaffordable_by_due_date";
    else if (
      cost.currentBalanceContribution > 0
      && currentAllocation === 0
      && futureAllocation > 0
      && firstFutureFunded?.sourceType === "primary_pay"
    ) state = "wait_until_payday";
    else if (futureAllocation > 0) state = "affordable_by_due_date";

    const plan = {
      costId: cost.id,
      name: cost.name || "Large cost",
      totalCost: cost.amount,
      dueDate: cost.dueDate,
      daysUntilDue: daysBetween(todayIso, cost.dueDate),
      fundingStatus: cost.fundingStatus,
      savingsContribution: cost.savingsContribution,
      currentBalanceContribution: cost.currentBalanceContribution,
      currentPeriodAllocation: currentAllocation,
      futurePeriodAllocations: planPeriods
        .filter((period) => period.index > 0 && period.protectedAmount > 0)
        .map((period) => ({
          payDate: period.payDate,
          sourceType: period.sourceType,
          sourceLabel: period.sourceLabel,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          amount: period.protectedAmount,
        })),
      safeDailyAmountBefore: planPeriods[0]?.safeDailyBefore || 0,
      safeDailyAmountAfter: planPeriods[0]?.safeDailyAfter || 0,
      shortfall,
      state,
      periods: planPeriods,
      actions: state === "unaffordable_by_due_date"
        ? ["Use more savings", "Reduce the cost", "Change the due date", "Review other Large Costs", "Review bills"]
        : [],
    };
    plan.deterministicExplanation = buildDeterministicExplanation(plan);
    return plan;
  });

  const summary = {
    currentPeriodProtected: money(periods[0]?.committedLargeCosts || 0),
    futurePeriodsPlanned: money(periods.slice(1).reduce((total, period) => total + period.committedLargeCosts, 0)),
    savingsBeingUsed: money(costs.reduce((total, cost) => total + cost.savingsContribution, 0)),
    savingsAvailable: Math.max(0, money(savingsAvailable)),
    totalShortfall: money(plans.reduce((total, plan) => total + plan.shortfall, 0)),
    plannedCostCount: plans.length,
    closestDueDate: costs[0]?.dueDate || null,
    affordabilityState: plans.reduce((worst, plan) => (
      statePriority(plan.state) > statePriority(worst) ? plan.state : worst
    ), plans.length ? "affordable_now" : null),
  };

  const chartAllocations = periods.flatMap((period) => {
    const amount = money(period.committedLargeCosts);
    if (amount <= 0) return [];
    return [{
      nextDueDate: period.index === 0 ? todayIso : period.start,
      currentAccountAmount: amount,
      periodIndex: period.index,
      sourceType: period.sourceType,
      sourceLabel: period.sourceLabel,
    }];
  });

  return {
    periods: periods.map((period) => ({
      ...period,
      resultingSafeSpendingRoom: Math.max(0, money(period.availableCommitmentCapacity - period.committedLargeCosts)),
      safeDailyAmount: money(Math.max(0, period.availableCommitmentCapacity - period.committedLargeCosts) / period.days),
    })),
    plans,
    summary,
    chartAllocations,
  };
}

export function getLargeCostFundingSourceLimits({
  todayIso,
  paydayDate,
  dueDate,
  currentBalance = 0,
  incomeAmount = 0,
  savingsAvailable = 0,
  bills = [],
  additionalIncomeEvents = [],
}) {
  const basePeriods = buildPayPeriods({
    todayIso,
    paydayDate,
    throughDate: dueDate || todayIso,
    currentBalance,
    incomeAmount,
  }).filter((period) => !dueDate || period.start <= dueDate);
  const periods = splitPeriodsAtAdditionalIncome(basePeriods, additionalIncomeEvents, todayIso)
    .filter((period) => !dueDate || period.start <= dueDate);
  const cashflowHorizon = periods[periods.length - 1]?.end || dueDate || todayIso;
  addBillsToPeriods(periods, bills, todayIso, cashflowHorizon);

  return {
    currentBalance: money(periods.reduce((total, period) => total + period.availableCommitmentCapacity, 0)),
    savings: Math.max(0, money(savingsAvailable)),
  };
}

export { money as roundCurrency };
