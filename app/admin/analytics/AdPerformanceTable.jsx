"use client";

import { useState } from "react";
import AdSpendForm from "@/components/admin/AdSpendForm";
import { formatGbp, formatPercent } from "./format";

export default function AdPerformanceTable({ adPerformance, onSpendSaved }) {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="admin-section">
      <div className="admin-header">
        <h2>Ad performance</h2>
        <button className="account-row" type="button" onClick={() => setShowForm((current) => !current)}>
          {showForm ? "Hide form" : "Add ad spend"}
        </button>
      </div>

      {showForm ? (
        <AdSpendForm onSaved={onSpendSaved} />
      ) : null}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Visitors</th>
              <th>Signups</th>
              <th>Paid</th>
              <th>Revenue</th>
              <th>Spend</th>
              <th>Cost / signup</th>
              <th>CAC</th>
              <th>Signup conv.</th>
              <th>Paid conv.</th>
              <th>ROAS</th>
            </tr>
          </thead>
          <tbody>
            {adPerformance.length === 0 ? (
              <tr><td colSpan={11}>No campaign activity in this range yet.</td></tr>
            ) : adPerformance.map((row) => (
              <tr key={row.campaign}>
                <td>{row.campaign}</td>
                <td>{row.visitors}</td>
                <td>{row.signups}</td>
                <td>{row.paidCustomers}</td>
                <td>{formatGbp(row.revenue)}</td>
                <td>{row.spend > 0 ? formatGbp(row.spend) : "—"}</td>
                <td>{row.costPerSignup != null ? formatGbp(row.costPerSignup) : "—"}</td>
                <td>{row.cac != null ? formatGbp(row.cac) : "—"}</td>
                <td>{formatPercent(row.signupConversionRate)}</td>
                <td>{formatPercent(row.paidConversionRate)}</td>
                <td>{row.roas != null ? `${row.roas.toFixed(2)}x` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
