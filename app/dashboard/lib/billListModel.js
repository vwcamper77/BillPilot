export const BILL_FILTERS = ["all", "before", "after", "paid", "recent"];

function compareDueDate(left, right) {
  const leftDate = left?.nextDueDate || "9999-12-31";
  const rightDate = right?.nextDueDate || "9999-12-31";
  return leftDate.localeCompare(rightDate) || String(left?.name || "").localeCompare(String(right?.name || ""));
}

export function sortBillItems(bills = [], sort = "due_asc") {
  const items = [...bills];
  if (sort === "amount_desc") {
    return items.sort((left, right) => Number(right.amount || 0) - Number(left.amount || 0) || compareDueDate(left, right));
  }
  if (sort === "name_asc") {
    return items.sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")) || compareDueDate(left, right));
  }
  return items.sort(compareDueDate);
}

export function buildBillListView({ bills = [], beforePaydayIds = new Set(), filter = "all", search = "", sort = "due_asc", isPaid, isRecent } = {}) {
  const query = String(search || "").trim().toLocaleLowerCase("en-GB");
  const searched = bills.filter((bill) => !query || `${bill.name || ""} ${bill.category || ""}`.toLocaleLowerCase("en-GB").includes(query));
  const filtered = searched.filter((bill) => {
    if (filter === "before") return beforePaydayIds.has(bill.id);
    if (filter === "after") return !beforePaydayIds.has(bill.id);
    if (filter === "paid") return Boolean(isPaid?.(bill));
    if (filter === "recent") return Boolean(isRecent?.(bill));
    return true;
  });
  const sorted = sortBillItems(filtered, sort);

  return {
    all: sorted,
    urgent: sorted.filter((bill) => beforePaydayIds.has(bill.id)),
    upcoming: sorted.filter((bill) => !beforePaydayIds.has(bill.id)),
  };
}
