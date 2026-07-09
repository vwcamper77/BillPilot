export function formatGbp(amount) {
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(amount);
}

// customers.totalPaid is stored in pence, matching billing/Stripe convention.
export function formatGbpFromPence(pence) {
  if (!Number.isFinite(pence)) return "—";
  return formatGbp(pence / 100);
}

export function formatPercent(ratio) {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(1)}%`;
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return "—";
  }
}

export function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(iso));
  } catch {
    return "—";
  }
}

export function labelizeEventName(eventName) {
  return String(eventName || "").split("_").join(" ");
}
