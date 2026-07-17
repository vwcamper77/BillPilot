function roundMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

export function deriveRunwayStatus(week, hasFundingGap = false) {
  if (hasFundingGap || Number(week?.weeklyMinimumBalance) < 0 || Number(week?.minimumProjectedBalance) < 0) {
    return "Warning";
  }

  const rates = [week?.dailyRate, week?.preDailyRate, week?.postDailyRate]
    .filter((rate) => rate !== null && rate !== undefined && Number.isFinite(Number(rate)));
  if (rates.length && rates.some((rate) => Number(rate) <= 0)) return "Tight";
  return "Clear";
}

export function buildSixWeekRunwayRows(plan = [], fundingGapDates = []) {
  const gaps = new Set(fundingGapDates.filter(Boolean));

  return plan.slice(0, 6).map((week, index) => {
    const outgoings = (week.steps || [])
      .filter((step) => Number(step.amount) < 0)
      .sort((a, b) => Math.abs(Number(b.amount)) - Math.abs(Number(a.amount)));
    const income = (week.steps || []).filter((step) => Number(step.amount) > 0);
    const hasFundingGap = [...gaps].some((date) => date >= week.weekStart && date <= week.weekEnd);
    const dailyRates = week.dailyRate !== null && week.dailyRate !== undefined
      ? [Number(week.dailyRate)]
      : [week.preDailyRate, week.postDailyRate].filter((rate) => rate !== null && rate !== undefined).map(Number);

    return {
      id: week.weekStart || `week-${index}`,
      index,
      label: index === 0 ? "This week" : `Week ${index + 1}`,
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      fixedOutgoings: roundMoney(outgoings.reduce((total, step) => total + Math.abs(Number(step.amount) || 0), 0)),
      incomeTotal: roundMoney(income.reduce((total, step) => total + Number(step.amount || 0), 0)),
      significantOutgoings: outgoings.slice(0, 3),
      additionalOutgoingCount: Math.max(0, outgoings.length - 3),
      dailyRates,
      projectedClosingBalance: roundMoney(week.projectedClosingBalance),
      status: deriveRunwayStatus(week, hasFundingGap),
      source: week,
    };
  });
}

export function calculateSpendTest({ safeUntilNextIncome, daysUntilNextIncome, amount }) {
  const current = roundMoney(safeUntilNextIncome);
  const testedAmount = Math.max(0, roundMoney(amount));
  const days = Math.max(1, Math.floor(Number(daysUntilNextIncome) || 1));
  const revised = roundMoney(current - testedAmount);

  return {
    currentAmount: current,
    testedAmount,
    revisedAmount: revised,
    revisedSafePerDay: roundMoney(revised / days),
    difference: roundMoney(revised - current),
    createsShortfall: revised < 0 && current >= 0,
    hasShortfall: revised < 0,
    daysUntilNextIncome: days,
  };
}
