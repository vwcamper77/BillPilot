export const UK_TIME_ZONE = "Europe/London";
const DEFAULT_REMINDER_OFFSET_DAYS = 1;

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

export function formatOrdinal(day) {
  const value = Number(day);
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

  if (!text) {
    return "";
  }

  return text
    .split(" ")
    .map((word) => {
      if (word.length <= 1) {
        return word.toUpperCase();
      }

      if (word === word.toUpperCase() && /[A-Z]/.test(word)) {
        return word;
      }

      return `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`;
    })
    .join(" ");
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
  todayIso = getTodayIso(),
) {
  const nextDueDate = getNextMonthlyDate(dueDay, todayIso);
  const reminderDate = addDaysIso(nextDueDate, -normaliseReminderOffset(reminderOffsetDays));

  return {
    nextDueDate,
    reminderDate,
  };
}

export function calculateIncomeSchedule(payDay, todayIso = getTodayIso()) {
  return {
    nextPayDate: getNextMonthlyDate(payDay, todayIso),
  };
}

export function buildBillDocument(parsed, todayIso = getTodayIso()) {
  const reminderOffsetDays = normaliseReminderOffset(parsed.reminderOffsetDays);
  const schedule = calculateBillSchedule(parsed.dueDay, reminderOffsetDays, todayIso);

  return {
    type: "bill",
    name: normaliseEntityName(parsed.name),
    amount: Number(parsed.amount),
    currency: parsed.currency || "GBP",
    frequency: "monthly",
    dueDay: Number(parsed.dueDay),
    reminderOffsetDays,
    reminderDate: schedule.reminderDate,
    nextDueDate: schedule.nextDueDate,
    active: true,
    lastReminderSentAt: null,
  };
}

export function buildIncomeDocument(parsed) {
  return {
    type: "income",
    name: normaliseEntityName(parsed.name || "Payday"),
    amount: Number(parsed.amount),
    currency: parsed.currency || "GBP",
    frequency: "monthly",
    payDay: Number(parsed.payDay),
    active: true,
  };
}

export function calculateDashboard(
  bills = [],
  income = null,
  account = null,
  todayIso = getTodayIso(),
) {
  const activeBills = bills
    .filter((bill) => bill.active !== false)
    .map((bill) => {
      const schedule = calculateBillSchedule(
        bill.dueDay,
        bill.reminderOffsetDays || DEFAULT_REMINDER_OFFSET_DAYS,
        todayIso,
      );

      return {
        ...bill,
        ...schedule,
        amount: Number(bill.amount) || 0,
      };
    })
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));

  const paydayDate = income?.active !== false && income?.payDay
    ? calculateIncomeSchedule(income.payDay, todayIso).nextPayDate
    : null;

  const beforePayday = paydayDate
    ? activeBills.filter((bill) => bill.nextDueDate < paydayDate)
    : [];
  const afterPayday = paydayDate
    ? activeBills.filter((bill) => bill.nextDueDate >= paydayDate)
    : activeBills;
  const nextBill = activeBills[0] || null;
  const totalBeforePayday = sumAmounts(beforePayday);
  const totalMonthlyBills = sumAmounts(activeBills);
  const currentBalance = Number(account?.currentBalance) || 0;
  const leftBeforePayday = currentBalance - totalBeforePayday;
  const leftAfterMonthlyBills = currentBalance - totalMonthlyBills;

  return {
    beforePayday,
    afterPayday,
    nextBill,
    paydayDate,
    currentBalance,
    totalBeforePayday,
    totalMonthlyBills,
    leftBeforePayday,
    leftAfterMonthlyBills,
    runwayEvents: buildRunwayEvents(beforePayday, paydayDate, todayIso),
  };
}

export function buildReminderMessage(targetBill, allBills = [], income = null, todayIso = getTodayIso()) {
  const targetSchedule = calculateBillSchedule(
    targetBill.dueDay,
    targetBill.reminderOffsetDays || DEFAULT_REMINDER_OFFSET_DAYS,
    todayIso,
  );
  const dueLabel = formatDueLabel(targetSchedule.nextDueDate, todayIso);
  const base = `${targetBill.name} is due ${dueLabel} — ${formatGBP(targetBill.amount)}.`;

  if (!income?.payDay) {
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
        todayIso,
      ),
    }))
    .filter(
      (bill) =>
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

function buildRunwayEvents(beforePayday, paydayDate, todayIso) {
  const events = [{ label: "Today", detail: formatDisplayDate(todayIso), type: "today" }];

  beforePayday.forEach((bill) => {
    events.push({
      label: bill.name,
      detail: `${formatGBP(bill.amount)} due ${formatDueLabel(bill.nextDueDate, todayIso)}`,
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

function sumAmounts(items) {
  return items.reduce((total, item) => total + (Number(item.amount) || 0), 0);
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

function diffDays(startIso, endIso) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((toUtcDate(endIso) - toUtcDate(startIso)) / msPerDay);
}

function toUtcDate(isoDate) {
  return new Date(`${isoDate}T12:00:00.000Z`);
}

function dateToIso(date) {
  return date.toISOString().slice(0, 10);
}
