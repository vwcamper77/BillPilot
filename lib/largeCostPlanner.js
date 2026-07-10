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
    month: "short",
    timeZone: "UTC",
  }).format(toUtcDate(isoDate));
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
  currentBalanceContribution = Math.min(amount, Math.max(0, money(currentBalanceContribution)));
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
    spread_across_pay_periods: 2,
    affordable_this_period: 1,
  }[state] || 0;
}

function buildDeterministicExplanation(plan) {
  const amount = `£${plan.totalCost.toLocaleString("en-GB", { minimumFractionDigits: Number.isInteger(plan.totalCost) ? 0 : 2, maximumFractionDigits: 2 })}`;
  const due = formatShortDate(plan.dueDate);
  const shortfall = `£${plan.shortfall.toLocaleString("en-GB", { minimumFractionDigits: Number.isInteger(plan.shortfall) ? 0 : 2, maximumFractionDigits: 2 })}`;
  const current = plan.periods[0];
  const afterDaily = `£${current.safeDailyAfter.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (plan.state === "unaffordable_by_due_date") {
    return `This ${amount} cost is not affordable by ${due} based on your current balance, expected pay, bills and other commitments. You are short by ${shortfall}.`;
  }
  if (plan.state === "wait_until_payday") {
    const firstFunded = plan.periods.find((period) => period.protectedAmount > 0);
    return `Do not take money from your current balance for this yet. The current period has no commitment capacity. The cost can begin to be funded in ${firstFunded?.label || "a future pay period"}.`;
  }
  if (plan.state === "spread_across_pay_periods") {
    const allocations = plan.periods
      .filter((period) => period.protectedAmount > 0)
      .map((period) => `${period.label}: £${period.protectedAmount.toFixed(2)}`)
      .join(", then ");
    return `You have ${plan.daysUntilDue} days to cover this ${amount} cost. Protect ${allocations}. This leaves around ${afterDaily} per day until payday.`;
  }
  if (plan.savingsContribution >= plan.totalCost) {
    return `This ${amount} cost is already covered from savings and does not reduce current-balance daily spending room.`;
  }
  return `You can cover this ${amount} cost before payday. After protecting it, you have £${current.resultingSafeSpendingRoom.toFixed(2)} left for ${current.days} days — approximately ${afterDaily} per day.`;
}

export function calculateLargeCostAffordabilityPlans({
  todayIso,
  paydayDate = null,
  currentBalance = 0,
  incomeAmount = 0,
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
  const periods = buildPayPeriods({ todayIso, paydayDate, throughDate, currentBalance, incomeAmount });
  addBillsToPeriods(periods, bills, todayIso, throughDate);

  const allocationsByCost = new Map();
  for (const cost of costs) {
    let remaining = money(cost.currentBalanceContribution);
    const allocations = periods.map(() => 0);

    for (const period of periods) {
      if (period.start > cost.dueDate || remaining <= 0) break;
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
    let state = "affordable_this_period";
    if (shortfall > 0) state = "unaffordable_by_due_date";
    else if (cost.currentBalanceContribution > 0 && currentAllocation === 0 && futureAllocation > 0) state = "wait_until_payday";
    else if (fundedPeriods.length > 1 || (currentAllocation > 0 && futureAllocation > 0)) state = "spread_across_pay_periods";

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
        .map((period) => ({ periodStart: period.periodStart, periodEnd: period.periodEnd, amount: period.protectedAmount })),
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
    closestDueDate: costs[0]?.dueDate || null,
    affordabilityState: plans.reduce((worst, plan) => (
      statePriority(plan.state) > statePriority(worst) ? plan.state : worst
    ), plans.length ? "affordable_this_period" : null),
  };

  const chartAllocations = periods.flatMap((period) => {
    const amount = money(period.committedLargeCosts);
    if (amount <= 0) return [];
    return [{
      nextDueDate: period.index === 0 ? todayIso : period.start,
      currentAccountAmount: amount,
      periodIndex: period.index,
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

export function getLargeCostFundingSourceLimits({ todayIso, paydayDate, dueDate, currentBalance = 0, incomeAmount = 0, savingsAvailable = 0 }) {
  const periods = buildPayPeriods({
    todayIso,
    paydayDate,
    throughDate: dueDate || todayIso,
    currentBalance,
    incomeAmount,
  }).filter((period) => !dueDate || period.start <= dueDate);

  return {
    currentBalance: money(periods.reduce((total, period) => total + period.openingAvailableBalance + period.expectedIncome, 0)),
    savings: Math.max(0, money(savingsAvailable)),
  };
}

export { money as roundCurrency };
