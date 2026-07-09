export const FOUNDING_PLAN = "founding_3_months";
export const FOUNDING_ACCESS_MONTHS = 3;

export function addMonths(baseDate, months) {
  const nextDate = new Date(baseDate);
  nextDate.setMonth(nextDate.getMonth() + months);
  return nextDate;
}

export function toDateMaybe(value) {
  if (!value) {
    return null;
  }

  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

export function hasActiveBillingAccess(billingRecord, now = new Date()) {
  const expiresAt = toDateMaybe(billingRecord?.accessExpiresAt);

  if (!expiresAt) {
    return false;
  }

  return expiresAt.getTime() > now.getTime();
}

export function formatBillingExpiry(billingRecord, locale = "en-GB") {
  const expiresAt = toDateMaybe(billingRecord?.accessExpiresAt);

  if (!expiresAt) {
    return "No access end date set";
  }

  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(expiresAt);
}
