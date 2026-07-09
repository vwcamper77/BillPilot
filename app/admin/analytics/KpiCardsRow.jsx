"use client";

import { formatGbp, formatPercent } from "./format";

export default function KpiCardsRow({ kpis }) {
  const cards = [
    { label: "Total signups", value: kpis.totalSignups },
    { label: "Signups today", value: kpis.signupsToday },
    { label: "Signups this week", value: kpis.signupsWeek },
    { label: "Signups this month", value: kpis.signupsMonth },
    { label: "Paid customers", value: kpis.paidCustomers },
    { label: "Trial users", value: kpis.hasSubscriptions ? kpis.trialUsers : "N/A — no subscription data", muted: !kpis.hasSubscriptions },
    { label: "Conversion rate", value: formatPercent(kpis.conversionRate) },
    { label: "Total revenue", value: formatGbp(kpis.totalRevenue) },
    { label: "Monthly recurring revenue", value: kpis.hasSubscriptions ? formatGbp(kpis.mrr) : "N/A — no subscription data", muted: !kpis.hasSubscriptions },
    { label: "Average revenue per customer", value: formatGbp(kpis.arpu) },
    { label: "Estimated CAC", value: kpis.hasAdSpend ? formatGbp(kpis.cac) : "N/A — no ad spend recorded", muted: !kpis.hasAdSpend },
    { label: "Estimated ROAS", value: kpis.hasAdSpend && kpis.roas != null ? `${kpis.roas.toFixed(2)}x` : "N/A — no ad spend recorded", muted: !kpis.hasAdSpend },
  ];

  return (
    <div className="admin-kpi-grid">
      {cards.map((card) => (
        <div className="admin-kpi-card" key={card.label}>
          <span className="admin-kpi-label">{card.label}</span>
          <strong className={`admin-kpi-value${card.muted ? " is-muted" : ""}`}>{card.value}</strong>
        </div>
      ))}
    </div>
  );
}
