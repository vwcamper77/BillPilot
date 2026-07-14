const VALID_FREQUENCIES = new Set(["one_off", "weekly", "fortnightly", "four_weekly", "monthly"]);
const VALID_CONFIDENCE = new Set(["confirmed", "estimated"]);
const VALID_OCCURRENCE_STATUSES = new Set(["scheduled", "received", "skipped", "overdue_unconfirmed"]);

export const REGULAR_SALARY_SOURCE_ID = "regular-salary";

export function normaliseIncomeSource(source = {}, fallbackId = null) {
  const firstPaymentDate = String(source.firstPaymentDate || source.expectedDate || "").trim();
  const frequency = VALID_FREQUENCIES.has(source.frequency) ? source.frequency : "one_off";
  const confidence = VALID_CONFIDENCE.has(source.confidence) ? source.confidence : "confirmed";
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(source.endDate || "")) ? String(source.endDate) : null;
  const occurrenceStatuses = Object.fromEntries(Object.entries(source.occurrenceStatuses || {})
    .filter(([date, status]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && VALID_OCCURRENCE_STATUSES.has(status)));

  return {
    ...source,
    id: source.id || fallbackId,
    name: String(source.name || "Income").trim() || "Income",
    amount: Math.round((Number(source.amount) || 0) * 100) / 100,
    firstPaymentDate,
    // Keep the old field during the compatibility window so older clients do
    // not lose the date if they encounter a migrated source.
    expectedDate: firstPaymentDate,
    frequency,
    endDate,
    active: source.active !== false && source.status !== "cancelled",
    confidence,
    occurrenceStatuses,
  };
}

export function legacySalaryToIncomeSource(income, todayIso) {
  if (!income || !(Number(income.amount) > 0) || !(Number(income.payDay) >= 1 && Number(income.payDay) <= 31)) return null;
  const today = new Date(`${todayIso}T12:00:00.000Z`);
  const preferredDay = Number(income.payDay);
  const lastDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0, 12)).getUTCDate();
  let first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), Math.min(preferredDay, lastDay), 12));
  if (first < today) {
    const nextLastDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 2, 0, 12)).getUTCDate();
    first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, Math.min(preferredDay, nextLastDay), 12));
  }
  return normaliseIncomeSource({
    id: REGULAR_SALARY_SOURCE_ID,
    name: "Regular salary",
    amount: Number(income.amount),
    firstPaymentDate: first.toISOString().slice(0, 10),
    frequency: "monthly",
    active: income.active !== false,
    confidence: "confirmed",
    migratedFrom: "income/main",
    legacyPayDay: preferredDay,
  });
}

export function mergeLegacySalary(incomeSources = [], legacyIncome, todayIso) {
  const sources = (incomeSources || []).map((source) => normaliseIncomeSource(source));
  const migrated = legacySalaryToIncomeSource(legacyIncome, todayIso);
  if (!migrated || sources.some((source) => source.id === REGULAR_SALARY_SOURCE_ID || source.migratedFrom === "income/main")) return sources;
  return [migrated, ...sources];
}

export function hasActiveIncomeSchedule(incomeSources = []) {
  return (incomeSources || []).some((source) => source?.active !== false && Number(source?.amount) > 0 && Boolean(source?.firstPaymentDate || source?.expectedDate));
}

export { VALID_CONFIDENCE, VALID_FREQUENCIES, VALID_OCCURRENCE_STATUSES };
