import { expect, test } from "@playwright/test";
import { buildBillListView, sortBillItems } from "../../app/dashboard/lib/billListModel.js";

const bills = [
  { id: "rent", name: "Rent", amount: 1100, nextDueDate: "2026-07-26", category: "housing" },
  { id: "water", name: "Affinity Water", amount: 35, nextDueDate: "2026-07-22", category: "utilities" },
  { id: "phone", name: "Mobile", amount: 28, nextDueDate: "2026-08-03", category: "utilities", paid: true },
  { id: "gym", name: "Gym", amount: 45, nextDueDate: "2026-08-08", category: "lifestyle", recent: true },
];

const beforePaydayIds = new Set(["rent", "water"]);
const options = {
  bills,
  beforePaydayIds,
  isPaid: (bill) => Boolean(bill.paid),
  isRecent: (bill) => Boolean(bill.recent),
};

test.describe("compact bill list model", () => {
  test("returns every active bill and separates the urgent payday group", () => {
    const view = buildBillListView(options);

    expect(view.all.map((bill) => bill.id)).toEqual(["water", "rent", "phone", "gym"]);
    expect(view.urgent.map((bill) => bill.id)).toEqual(["water", "rent"]);
    expect(view.upcoming.map((bill) => bill.id)).toEqual(["phone", "gym"]);
  });

  test("keeps a normal fifteen-bill account in one unpaginated result", () => {
    const normalAccount = Array.from({ length: 15 }, (_, index) => ({
      id: `bill-${index + 1}`,
      name: `Bill ${index + 1}`,
      amount: index + 1,
      nextDueDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
    }));

    expect(buildBillListView({ bills: normalAccount }).all).toHaveLength(15);
  });

  test("searches bill names and categories", () => {
    expect(buildBillListView({ ...options, search: "affinity" }).all.map((bill) => bill.id)).toEqual(["water"]);
    expect(buildBillListView({ ...options, search: "lifestyle" }).all.map((bill) => bill.id)).toEqual(["gym"]);
  });

  test("supports payday, paid and recently-added filters", () => {
    expect(buildBillListView({ ...options, filter: "before" }).all.map((bill) => bill.id)).toEqual(["water", "rent"]);
    expect(buildBillListView({ ...options, filter: "after" }).all.map((bill) => bill.id)).toEqual(["phone", "gym"]);
    expect(buildBillListView({ ...options, filter: "paid" }).all.map((bill) => bill.id)).toEqual(["phone"]);
    expect(buildBillListView({ ...options, filter: "recent" }).all.map((bill) => bill.id)).toEqual(["gym"]);
  });

  test("sorts by due date, amount and name without mutating the input", () => {
    const original = [...bills];

    expect(sortBillItems(bills).map((bill) => bill.id)).toEqual(["water", "rent", "phone", "gym"]);
    expect(sortBillItems(bills, "amount_desc").map((bill) => bill.id)).toEqual(["rent", "gym", "water", "phone"]);
    expect(sortBillItems(bills, "name_asc").map((bill) => bill.id)).toEqual(["water", "gym", "phone", "rent"]);
    expect(bills).toEqual(original);
  });
});
