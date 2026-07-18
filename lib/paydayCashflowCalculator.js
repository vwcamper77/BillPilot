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

export function calculatePaydayCashflow({ availableCashPence, bills = [] }) {
  assertPenceInRange("availableCashPence", availableCashPence);
  if (!Array.isArray(bills)) throw new TypeError("Bills must be an array.");

  const totalBillsPence = bills.reduce((total, bill, index) => {
    if (!bill || typeof bill !== "object") throw new TypeError(`Bill ${index + 1} must be an object.`);
    assertPenceInRange(`Bill ${index + 1} amount`, bill.amountPence);
    return total + bill.amountPence;
  }, 0);
  const netAvailablePence = availableCashPence - totalBillsPence;

  return {
    availableCashPence,
    totalBillsPence,
    netAvailablePence,
    shortfallPence: Math.max(0, -netAvailablePence),
    isShortfall: netAvailablePence < 0,
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

export function getPacingFigures(availableCashPence, pacingDays) {
  if (!Number.isSafeInteger(availableCashPence) || availableCashPence < 0 || !Number.isInteger(pacingDays) || pacingDays < 1) {
    throw new TypeError("Valid pence and pacing days are required.");
  }
  return {
    // Round down to a whole penny so the daily amount never exceeds the available cash.
    dailyPence: Math.floor(availableCashPence / pacingDays),
  };
}

export function buildCashRunway({ availableCashPence, bills = [], todayIso, paydayIso }) {
  assertPenceInRange("availableCashPence", availableCashPence);
  const period = getCalculationPeriod(paydayIso, todayIso);
  if (!Array.isArray(bills)) throw new TypeError("Bills must be an array.");

  const billsByDate = new Map();
  for (const [index, bill] of bills.entries()) {
    if (!bill || typeof bill !== "object") throw new TypeError(`Bill ${index + 1} must be an object.`);
    assertPenceInRange(`Bill ${index + 1} amount`, bill.amountPence);
    const daysFromToday = calendarDaysBetween(todayIso, bill.date);
    const daysToPayday = calendarDaysBetween(bill.date, paydayIso);
    if (daysFromToday < 0 || daysToPayday < 0) {
      throw new RangeError(`Bill ${index + 1} must be due between today and payday.`);
    }
    const datedBills = billsByDate.get(bill.date) || [];
    datedBills.push({ name: String(bill.name || `Bill ${index + 1}`), amountPence: bill.amountPence });
    billsByDate.set(bill.date, datedBills);
  }

  let remainingPence = availableCashPence;
  const start = parseIsoCalendarDate(todayIso);
  const points = [];
  for (let dayIndex = 0; dayIndex < period.planningDays; dayIndex += 1) {
    const date = new Date(start.utcTime + (dayIndex * DAY_MS)).toISOString().slice(0, 10);
    const datedBills = billsByDate.get(date) || [];
    const billsTotalPence = datedBills.reduce((total, bill) => total + bill.amountPence, 0);
    remainingPence -= billsTotalPence;
    points.push({ date, dayIndex, bills: datedBills, billsTotalPence, remainingPence });
  }

  return points;
}

export function formatGbp(pence) {
  if (!Number.isSafeInteger(pence)) throw new TypeError("Currency must be a whole number of pence.");
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
}
