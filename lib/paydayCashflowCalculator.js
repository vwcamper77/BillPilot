const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONEY = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// A deliberately conservative per-field ceiling for a short-horizon consumer tool.
export const MAX_MONEY_PENCE = 100_000_000;
export const MAX_MONEY_DISPLAY = "£1,000,000.00";

function assertPenceInRange(name, value, { allowNegative = false } = {}) {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be a whole number of pence.`);
  if (!allowNegative && value < 0) throw new RangeError(`${name} cannot be negative.`);
  if (Math.abs(value) > MAX_MONEY_PENCE) {
    throw new RangeError(`${name} cannot be greater than ${MAX_MONEY_DISPLAY}.`);
  }
}

export function parseMoneyToPence(value, { allowNegative = false, optional = false } = {}) {
  const normalised = String(value ?? "").trim();
  if (!normalised) {
    if (optional) return 0;
    throw new Error("Enter an amount.");
  }

  const match = normalised.match(MONEY);
  if (!match) throw new Error("Enter pounds and pence using no more than two decimal places.");
  if (match[1] && !allowNegative) throw new Error("Enter zero or a positive amount.");

  const pounds = Number(match[2]);
  const pennies = Number((match[3] || "").padEnd(2, "0"));
  const pence = (pounds * 100) + pennies;
  const signedPence = match[1] ? -pence : pence;
  if (!Number.isSafeInteger(signedPence)) throw new Error("Enter a smaller amount.");
  if (Math.abs(signedPence) > MAX_MONEY_PENCE) {
    throw new Error(`Enter an amount no greater than ${MAX_MONEY_DISPLAY}.`);
  }
  return signedPence;
}

export function calculatePaydayCashflow({
  currentBalancePence,
  confirmedIncomeBeforeDatePence = 0,
  billsDueBeforeDatePence = 0,
  oneOffCommittedCostsPence = 0,
  safetyBufferPence = 0,
}) {
  const values = {
    currentBalancePence,
    confirmedIncomeBeforeDatePence,
    billsDueBeforeDatePence,
    oneOffCommittedCostsPence,
    safetyBufferPence,
  };

  for (const [name, value] of Object.entries(values)) {
    assertPenceInRange(name, value, { allowNegative: name === "currentBalancePence" });
  }

  const clearToSpendPence = currentBalancePence
    + confirmedIncomeBeforeDatePence
    - billsDueBeforeDatePence
    - oneOffCommittedCostsPence
    - safetyBufferPence;

  if (!Number.isSafeInteger(clearToSpendPence)) throw new RangeError("The calculation is outside the supported range.");

  return {
    clearToSpendPence,
    shortfallPence: clearToSpendPence < 0 ? Math.abs(clearToSpendPence) : 0,
    isShortfall: clearToSpendPence < 0,
  };
}

export function parseIsoCalendarDate(value) {
  const match = String(value || "").match(ISO_DATE);
  if (!match) throw new Error("Choose a valid date.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcTime = Date.UTC(year, month - 1, day);
  const date = new Date(utcTime);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("Choose a valid date.");
  }
  return { year, month, day, utcTime };
}

export function calendarDaysBetween(startIso, endIso) {
  const start = parseIsoCalendarDate(startIso);
  const end = parseIsoCalendarDate(endIso);
  return Math.round((end.utcTime - start.utcTime) / DAY_MS);
}

function sumDatedPence(entries, endDateIso, { includeEndDate }) {
  if (!Array.isArray(entries)) throw new TypeError("Dated entries must be an array.");
  parseIsoCalendarDate(endDateIso);

  return entries.reduce((total, entry, index) => {
    if (!entry || typeof entry !== "object") throw new TypeError(`Entry ${index + 1} must be an object.`);
    assertPenceInRange(`Entry ${index + 1} amount`, entry.amountPence);
    const daysBeforeEnd = calendarDaysBetween(entry.date, endDateIso);
    const belongsInPeriod = daysBeforeEnd > 0 || (includeEndDate && daysBeforeEnd === 0);
    return belongsInPeriod ? total + entry.amountPence : total;
  }, 0);
}

export function calculateConfirmedIncomeBeforeDate(entries, endDateIso) {
  return sumDatedPence(entries, endDateIso, { includeEndDate: false });
}

export function calculateCommittedCostsThroughDate(entries, endDateIso) {
  return sumDatedPence(entries, endDateIso, { includeEndDate: true });
}

export function getLondonTodayIso(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getCalculationPeriod(selectedDateIso, todayIso = getLondonTodayIso()) {
  const daysUntilIncome = calendarDaysBetween(todayIso, selectedDateIso);
  if (daysUntilIncome < 0) throw new Error("Choose today or a future date.");
  const planningDays = daysUntilIncome + 1;
  return {
    daysUntilIncome,
    planningDays,
    pacingDays: planningDays,
    isSameDay: daysUntilIncome === 0,
  };
}

export function getPacingFigures(clearToSpendPence, pacingDays, daysUntilIncome) {
  if (!Number.isSafeInteger(clearToSpendPence) || !Number.isInteger(pacingDays) || pacingDays < 1) {
    throw new TypeError("Valid pence and pacing days are required.");
  }
  if (clearToSpendPence < 0) return { dailyPence: null, weeklyPence: null };
  return {
    // Round down to a whole penny so an indicative pace never exceeds the total.
    dailyPence: Math.floor(clearToSpendPence / pacingDays),
    weeklyPence: daysUntilIncome >= 7 ? Math.floor((clearToSpendPence * 7) / pacingDays) : null,
  };
}

export function formatGbp(pence) {
  if (!Number.isSafeInteger(pence)) throw new TypeError("Currency must be a whole number of pence.");
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
}
