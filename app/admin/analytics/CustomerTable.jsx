"use client";

import { useMemo, useState } from "react";
import { formatDateTime, formatGbpFromPence, labelizeEventName } from "./format";

const COLUMNS = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "createdAt", label: "Signup" },
  { key: "paymentStatus", label: "Payment" },
  { key: "totalPaid", label: "Amount paid" },
  { key: "stripeCustomerId", label: "Stripe ID" },
  { key: "subscriptionStatus", label: "Subscription" },
  { key: "source", label: "Source / medium / campaign" },
  { key: "landingPage", label: "Landing page" },
  { key: "referrer", label: "Referrer" },
  { key: "device", label: "Device / browser" },
  { key: "firstActionAfterSignup", label: "First action" },
  { key: "billsCount", label: "Bills added" },
  { key: "lastActiveAt", label: "Last active" },
  { key: "onboardingStatus", label: "Onboarding" },
  { key: "dropOffStage", label: "Drop-off stage" },
];

function getSortValue(customer, key) {
  switch (key) {
    case "source":
      return customer.attribution?.utm_source || "";
    case "landingPage":
      return customer.attribution?.landingPage || "";
    case "referrer":
      return customer.attribution?.referrer || "";
    case "device":
      return customer.lastDevice?.type || "";
    default:
      return customer[key] ?? "";
  }
}

export default function CustomerTable({ customers, onRowClick }) {
  const [search, setSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [dropOffFilter, setDropOffFilter] = useState("all");
  const [sort, setSort] = useState({ key: "createdAt", direction: "desc" });

  const sources = useMemo(
    () => Array.from(new Set(customers.map((c) => c.attribution?.utm_source).filter(Boolean))).sort(),
    [customers],
  );
  const dropOffStages = useMemo(
    () => Array.from(new Set(customers.map((c) => c.dropOffStage).filter(Boolean))).sort(),
    [customers],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    let rows = customers.filter((customer) => {
      if (query) {
        const haystack = `${customer.name || ""} ${customer.email || ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (paymentFilter === "paid" && customer.paymentStatus !== "paid") return false;
      if (paymentFilter === "unpaid" && customer.paymentStatus === "paid") return false;
      if (sourceFilter !== "all" && customer.attribution?.utm_source !== sourceFilter) return false;
      if (dropOffFilter !== "all" && customer.dropOffStage !== dropOffFilter) return false;
      return true;
    });

    rows = [...rows].sort((a, b) => {
      const aValue = getSortValue(a, sort.key);
      const bValue = getSortValue(b, sort.key);
      const direction = sort.direction === "asc" ? 1 : -1;

      if (typeof aValue === "number" && typeof bValue === "number") {
        return (aValue - bValue) * direction;
      }
      return String(aValue).localeCompare(String(bValue)) * direction;
    });

    return rows;
  }, [customers, search, paymentFilter, sourceFilter, dropOffFilter, sort]);

  function toggleSort(key) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  }

  return (
    <div className="admin-section">
      <h2>Customers</h2>

      <div className="admin-filter-bar">
        <input
          type="search"
          placeholder="Search name or email"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}>
          <option value="all">All payment status</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option>
        </select>
        <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
          <option value="all">All sources</option>
          {sources.map((source) => <option key={source} value={source}>{source}</option>)}
        </select>
        <select value={dropOffFilter} onChange={(event) => setDropOffFilter(event.target.value)}>
          <option value="all">All drop-off stages</option>
          {dropOffStages.map((stage) => <option key={stage} value={stage}>{labelizeEventName(stage)}</option>)}
        </select>
        <span className="helper-text">{filtered.length} of {customers.length}</span>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th key={column.key} onClick={() => toggleSort(column.key)}>
                  {column.label}{sort.key === column.key ? (sort.direction === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={COLUMNS.length}>No customers match these filters.</td></tr>
            ) : filtered.map((customer) => (
              <tr
                key={customer.uid}
                className="admin-table-row-clickable"
                onClick={() => onRowClick(customer.uid)}
              >
                <td>{customer.name || "—"}</td>
                <td>{customer.email || "—"}</td>
                <td>{formatDateTime(customer.createdAt)}</td>
                <td>
                  <span className={`admin-badge ${customer.paymentStatus === "paid" ? "admin-badge-paid" : "admin-badge-none"}`}>
                    {customer.paymentStatus}
                  </span>
                </td>
                <td>{formatGbpFromPence(customer.totalPaid)}</td>
                <td>{customer.stripeCustomerId || "—"}</td>
                <td>{customer.subscriptionStatus}</td>
                <td>
                  {[customer.attribution?.utm_source, customer.attribution?.utm_medium, customer.attribution?.utm_campaign]
                    .filter(Boolean).join(" / ") || "—"}
                </td>
                <td>{customer.attribution?.landingPage || "—"}</td>
                <td>{customer.attribution?.referrer || "direct"}</td>
                <td>{customer.lastDevice ? `${customer.lastDevice.type} / ${customer.lastDevice.browser}` : "—"}</td>
                <td>{customer.firstActionAfterSignup ? labelizeEventName(customer.firstActionAfterSignup) : "—"}</td>
                <td>{customer.billsCount}</td>
                <td>{formatDateTime(customer.lastActiveAt)}</td>
                <td>{customer.onboardingStatus}</td>
                <td>{customer.dropOffStage ? labelizeEventName(customer.dropOffStage) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
